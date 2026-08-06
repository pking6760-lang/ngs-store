import { useEffect, useRef, useState } from "react";
import {
  storeQrGet, storeQrList, storeQrCreateFixed, storeQrHistory, storeQrSync, storeQrRemove, storeQrSetName,
} from "../lib/api.js";
import qrcode from "qrcode-generator";
import { decodeUpiFromQr, qrDataUri } from "../lib/payments.js";
import { unlockAudio, announcePayment } from "../lib/sound.js";
import { shop } from "../data/shop.js";
import { toast } from "../lib/toast.js";
import { Ic } from "./AdminIcons.jsx";
import gpayLogo from "../assets/upi/gpay.png";
import phonepeLogo from "../assets/upi/phonepe.png";
import paytmLogo from "../assets/upi/paytm.png";
import bhimLogo from "../assets/upi/bhim.png";

const STORE_NAME = (shop && shop.name) || "NGS Store";
const BRAND = "#d81f26";
const INK = "#141b24";
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const whenText = (ms) => ms ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

// ── small canvas helpers ────────────────────────────────────────────────────
const FONT = "-apple-system, Segoe UI, Roboto, sans-serif";
function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
// High error-correction QR so a small centre logo stays scannable.
function qrHigh(text, cell = 14, margin = 1) {
  const q = qrcode(0, "H"); q.addData(text); q.make();
  return q.createDataURL(cell, margin);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw a premium, printable payment standee. Returns { dataUrl, blob }.
// Prefers redrawing the QR crisp from the decoded UPI string; falls back to the
// original PNG if we couldn't decode it.
async function makePoster({ upi, imageFallback, amount, label }) {
  const W = 900, H = 1260, cx = W / 2;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const mono = (STORE_NAME.trim()[0] || "N").toUpperCase();

  // Backdrop + white card
  ctx.fillStyle = "#eef0f3"; ctx.fillRect(0, 0, W, H);
  const cardX = 44, cardY = 44, cardW = W - 88, cardH = H - 88;
  ctx.save();
  ctx.shadowColor = "rgba(20,27,36,.14)"; ctx.shadowBlur = 46; ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#ffffff"; roundRect(ctx, cardX, cardY, cardW, cardH, 44); ctx.fill();
  ctx.restore();

  // Monogram badge
  const badgeY = 150, badgeR = 48;
  ctx.fillStyle = BRAND; ctx.beginPath(); ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `800 46px ${FONT}`; ctx.fillText(mono, cx, badgeY + 3);
  ctx.textBaseline = "alphabetic";

  // Store name + caption
  ctx.fillStyle = INK; ctx.font = `800 48px ${FONT}`;
  ctx.fillText(STORE_NAME, cx, badgeY + 112);
  ctx.fillStyle = "#8a94a1"; ctx.font = `600 25px ${FONT}`;
  ctx.fillText("Scan with any UPI app", cx, badgeY + 152);

  // QR frame
  const qs = 480;
  const frameX = cx - qs / 2 - 34, frameY = badgeY + 196;
  const frameW = qs + 68, frameH = qs + 68;
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#edeff2"; ctx.lineWidth = 2;
  roundRect(ctx, frameX, frameY, frameW, frameH, 30); ctx.fill(); ctx.stroke();

  // Corner brackets (brand accent)
  ctx.strokeStyle = BRAND; ctx.lineWidth = 8; ctx.lineCap = "round";
  const bl = 48, off = 20;
  [[frameX + off, frameY + off, 1, 1], [frameX + frameW - off, frameY + off, -1, 1],
   [frameX + off, frameY + frameH - off, 1, -1], [frameX + frameW - off, frameY + frameH - off, -1, -1]]
    .forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + sy * bl); ctx.lineTo(x, y); ctx.lineTo(x + sx * bl, y); ctx.stroke();
    });

  // QR (high error-correction) + centre monogram
  const qrSrc = upi ? qrHigh(upi, 16, 1) : imageFallback;
  const qimg = qrSrc ? await loadImg(qrSrc) : null;
  const qx = cx - qs / 2, qy = frameY + 34, qcy = qy + qs / 2;
  if (qimg) ctx.drawImage(qimg, qx, qy, qs, qs);
  const midR = 46;
  ctx.fillStyle = "#fff"; roundRect(ctx, cx - midR, qcy - midR, midR * 2, midR * 2, 18); ctx.fill();
  ctx.fillStyle = BRAND; ctx.beginPath(); ctx.arc(cx, qcy, midR - 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `800 30px ${FONT}`; ctx.fillText(mono, cx, qcy + 1);
  ctx.textBaseline = "alphabetic";

  // Optional amount pill (fixed QRs only)
  let y = frameY + frameH + 72;
  if (amount != null) {
    const amt = rupee(amount);
    ctx.font = `800 42px ${FONT}`;
    const pillW = ctx.measureText(amt).width + 72, pillH = 72, pillX = cx - pillW / 2, pillY = y - 52;
    ctx.fillStyle = BRAND; roundRect(ctx, pillX, pillY, pillW, pillH, 36); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(amt, cx, pillY + 50);
    y = pillY + pillH + 44;
    if (label) { ctx.fillStyle = "#8a94a1"; ctx.font = `500 27px ${FONT}`; ctx.fillText(label, cx, y); y += 40; }
  }

  // Real UPI app logos, centered
  const logos = (await Promise.all([gpayLogo, phonepeLogo, paytmLogo, bhimLogo].map(loadImg))).filter(Boolean);
  const LH = 44, gap = 44;
  const ws = logos.map((im) => LH * (im.naturalWidth / im.naturalHeight));
  const totalW = ws.reduce((a, b) => a + b, 0) + gap * Math.max(0, logos.length - 1);
  let lx = cx - totalW / 2;
  const ly = (amount != null ? y + 4 : frameY + frameH + 64);
  logos.forEach((im, i) => { ctx.drawImage(im, lx, ly, ws[i], LH); lx += ws[i] + gap; });

  // Subtle footer
  ctx.fillStyle = "#aeb6c0"; ctx.textAlign = "center"; ctx.font = `600 22px ${FONT}`;
  ctx.fillText("Secured by UPI", cx, cardY + cardH - 42);

  const dataUrl = c.toDataURL("image/png");
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return { dataUrl, blob };
}

// Running inside the packaged Android app (Capacitor WebView)? The browser's
// <a download> and navigator.share(files) don't work there, so we use the native
// Filesystem / Share / FileOpener plugins instead — same approach as UpdateGate.
const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// Download or share a QR poster. Uses native plugins inside the app, and the
// browser APIs on the web.
async function exportPoster({ upi, imageFallback, amount, label }, mode) {
  const { dataUrl, blob } = await makePoster({ upi, imageFallback, amount, label });
  const namePart = amount != null ? `${amount}` : "open";
  const filename = `${STORE_NAME.replace(/\s+/g, "-")}-QR-${namePart}.png`;

  // ── Inside the Android app ────────────────────────────────────────────────
  if (IS_NATIVE) {
    const base64 = String(dataUrl).split(",")[1] || "";
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      if (mode === "share") {
        // Write to the app cache, then hand the file to the native share sheet
        // (WhatsApp, Gmail, save to Files, …).
        const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        const { Share } = await import("@capacitor/share");
        try {
          await Share.share({ title: `${STORE_NAME} — Pay by UPI`, text: "Scan this to pay", files: [w.uri] });
        } catch (e) {
          if (!/cancel/i.test(e?.message || "")) throw e;   // ignore user-cancelled
        }
      } else {
        // Save to the app cache, then open it in the phone's gallery/viewer,
        // from where it can be kept or shared. (Cache is what FileOpener's own
        // FileProvider is configured to serve — same as the in-app updater.)
        const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        const { FileOpener } = await import("@capacitor-community/file-opener");
        await FileOpener.open({ filePath: w.uri, contentType: "image/png" });
        toast("QR saved — save it to your gallery or share it from here.");
      }
    } catch (e) {
      toast(e?.message || "Couldn’t complete that — please try again.");
    }
    return;
  }

  // ── On the web ────────────────────────────────────────────────────────────
  if (mode === "share") {
    const file = blob ? new File([blob], filename, { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${STORE_NAME} — Pay by UPI`, text: "Scan to pay" });
        return;
      } catch { /* user cancelled or unsupported → fall through to download */ }
    }
    toast("Sharing isn’t available here — downloaded instead.");
  }
  downloadDataUrl(dataUrl, filename);
}

export default function StoreQR() {
  const [tab, setTab] = useState("open");   // open · fixed · history
  const [sbOn, setSbOn] = useState(() => localStorage.getItem("ngs_sb_on") !== "0");
  const [sbLang, setSbLang] = useState(() => localStorage.getItem("ngs_sb_lang") || "en-IN");

  useEffect(() => { localStorage.setItem("ngs_sb_on", sbOn ? "1" : "0"); }, [sbOn]);
  useEffect(() => { localStorage.setItem("ngs_sb_lang", sbLang); }, [sbLang]);

  function testVoice() { unlockAudio(); announcePayment(199, sbLang); }

  return (
    <section className="panel">
      <h3>Store QR</h3>
      <p className="panel-sub">
        Your shop’s permanent UPI QR — like a Paytm soundbox sticker. Print it once; customers scan and pay any amount, and the soundbox announces every payment. No expiry.
      </p>

      <div className="cq-tabs">
        <button className={`cq-tab ${tab === "open" ? "on" : ""}`}
          onClick={() => { unlockAudio(); setTab("open"); }}>Scan &amp; Pay</button>
        <button className={`cq-tab ${tab === "fixed" ? "on" : ""}`}
          onClick={() => { unlockAudio(); setTab("fixed"); }}>Fixed amount</button>
        <button className={`cq-tab ${tab === "history" ? "on" : ""}`}
          onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "open" && <OpenQr sbOn={sbOn} sbLang={sbLang} />}
      {tab === "fixed" && <FixedQrs />}
      {tab === "history" && <StoreHistory qrId={null} />}

      <div className="cq-soundbox">
        <span className="cq-sb-ico"><Ic name="broadcast" size={16} /></span>
        <div className="cq-sb-text">
          <span className="cq-sb-title">Soundbox</span>
          <span className="cq-sb-sub">Announce payments aloud</span>
        </div>
        {sbOn && (
          <div className="cq-sb-lang">
            <button className={sbLang === "en-IN" ? "on" : ""} onClick={() => setSbLang("en-IN")}>EN</button>
            <button className={sbLang === "hi-IN" ? "on" : ""} onClick={() => setSbLang("hi-IN")}>हिं</button>
          </div>
        )}
        <button className="cq-sb-test" onClick={testVoice} title="Test the voice">Test</button>
        <label className="an-switch"><input type="checkbox" checked={sbOn} onChange={(e) => setSbOn(e.target.checked)} /><span /></label>
      </div>
    </section>
  );
}

// ── The main, no-expiry, any-amount store QR ────────────────────────────────
function OpenQr({ sbOn, sbLang }) {
  const [qr, setQr] = useState(null);       // { qrId, imageDataUrl, upi }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]); // last few payments (live)
  const seen = useRef(new Set());
  const poll = useRef(null);       // fast DB poll (feed + announce)
  const syncPoll = useRef(null);   // slow Razorpay safety-sync

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await storeQrGet();
        const q = r?.qr;
        if (!q) throw new Error("Couldn’t load the QR.");
        const upi = await decodeUpiFromQr(q.imageDataUrl).catch(() => "");
        if (live) setQr({ ...q, upi });
        // Seed "seen" with existing payments so we don't announce old ones.
        const h = await storeQrHistory(q.qrId).catch(() => ({ items: [] }));
        (h.items || []).forEach((it) => seen.current.add(it.paymentId));
        if (live) setRecent((h.items || []).slice(0, 6));
        startPolling(q.qrId);
      } catch (e) { if (live) setErr(e.message || "Couldn’t load the QR."); }
    })();
    return () => { live = false; stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    if (syncPoll.current) { clearInterval(syncPoll.current); syncPoll.current = null; }
  }
  function startPolling(qrId) {
    stopPolling();
    // FAST path: read the DB every 2s. When the Razorpay webhook records a
    // payment (instant), this announces it within ~2s — no waiting on Razorpay.
    const pull = async () => {
      try {
        const r = await storeQrHistory(qrId);
        const items = r?.items || [];
        const fresh = items.filter((it) => it.paymentId && !seen.current.has(it.paymentId));
        fresh.reverse().forEach((it) => {
          seen.current.add(it.paymentId);
          if (localStorage.getItem("ngs_sb_on") !== "0") {
            announcePayment(it.amount, localStorage.getItem("ngs_sb_lang") || "en-IN", it.name || "");
          }
        });
        setRecent(items.slice(0, 6));
      } catch { /* keep polling */ }
    };
    poll.current = setInterval(pull, 2000);
    // SAFETY NET: if the webhook isn't set up, pull new payments in from Razorpay
    // every few seconds so rows still appear (and the soundbox announces). Kept
    // separate + slower so it never blocks the fast DB poll above.
    syncPoll.current = setInterval(() => { storeQrSync(qrId).catch(() => {}); }, 7000);
  }

  const shownQr = qr && (qr.upi ? qrDataUri(qr.upi, 8, 4) : qr.imageDataUrl);

  if (err) return <p className="an-warn" style={{ margin: "10px 2px" }}>⚠ {err}</p>;
  if (!qr) return <p className="panel-sub">Loading your store QR…</p>;

  return (
    <div className="sq-open">
      <div className="cq-qwrap sq-qwrap">
        <img className="cq-qr" src={shownQr} alt="Scan to pay" />
      </div>
      <div className="sq-store">{STORE_NAME}</div>
      <div className="sq-any">Scan with any UPI app</div>
      <div className="sq-actions">
        <button className="an-btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await exportPoster({ upi: qr.upi, imageFallback: qr.imageDataUrl, amount: null }, "download"); }
          finally { setBusy(false); }
        }}><Ic name="download" size={16} /> Download</button>
        <button className="an-btn ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await exportPoster({ upi: qr.upi, imageFallback: qr.imageDataUrl, amount: null }, "share"); }
          finally { setBusy(false); }
        }}><Ic name="share" size={16} /> Share</button>
      </div>

      <div className="sq-live">
        <span className="cq-dot" /> Live — {sbOn ? "announcing payments" : "soundbox off"}
      </div>

      {recent.length > 0 && (
        <div className="sq-recent">
          <div className="sq-recent-h">Recent payments</div>
          {recent.map((it) => (
            <div className="cq-hist-row" key={it.id}>
              <div className="cq-hist-main">
                <div className="cq-hist-top"><span className="cq-hist-amt">{rupee(it.amount)}</span></div>
                <div className="cq-hist-sub">
                  <PayerName vpa={it.vpa} name={it.name}
                    onSaved={(vpa, name) => setRecent((rs) => rs.map((r) => r.vpa === vpa ? { ...r, name } : r))} />
                  {" · "}{whenText(it.paidAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fixed-amount QRs (permanent, reusable, downloadable/shareable) ───────────
function FixedQrs() {
  const [items, setItems] = useState(null);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const r = await storeQrList();
      setItems((r?.items || []).filter((q) => q.kind === "fixed"));
    } catch (e) { setErr(e.message || "Couldn’t load."); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const rupees = Number(amount);
    if (!(rupees > 0)) { setErr("Enter an amount first."); return; }
    setBusy(true); setErr("");
    try {
      await storeQrCreateFixed(rupees, label.trim());
      setAmount(""); setLabel("");
      await load();
    } catch (e) { setErr(e.message || "Couldn’t create the QR."); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Delete this fixed QR? It can’t be paid after removal.")) return;
    try { await storeQrRemove(id); await load(); }
    catch (e) { toast(e.message || "Couldn’t delete."); }
  }

  return (
    <div className="sq-fixed">
      <p className="panel-sub">
        Make a QR for a set price (e.g. a ₹100 sticker for one item). It never expires and can be paid again and again — download or share it.
      </p>
      {err && <p className="an-warn" style={{ margin: "4px 2px 10px" }}>⚠ {err}</p>}

      <div className="cq-entry">
        <label className="cq-amount">
          <span className="cq-cur">₹</span>
          <input type="number" inputMode="decimal" min="1" step="1" placeholder="0"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
        </label>
        <input className="an-input cq-note" type="text" maxLength={80}
          placeholder="Name / item (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="an-btn cq-go" disabled={busy || !(Number(amount) > 0)} onClick={create}>
          {busy ? "Creating…" : "Create fixed QR"}
        </button>
      </div>

      {items === null ? (
        <p className="panel-sub">Loading…</p>
      ) : items.length === 0 ? (
        <p className="panel-sub">No fixed QRs yet.</p>
      ) : (
        <div className="sq-grid">
          {items.map((q) => <FixedCard key={q.id} q={q} onRemove={() => remove(q.id)} />)}
        </div>
      )}
    </div>
  );
}

function FixedCard({ q, onRemove }) {
  const [upi, setUpi] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    decodeUpiFromQr(q.imageDataUrl).then((u) => { if (live) setUpi(u); }).catch(() => {});
    return () => { live = false; };
  }, [q.imageDataUrl]);
  const shown = upi ? qrDataUri(upi, 6, 4) : q.imageDataUrl;

  async function act(mode) {
    setBusy(true);
    try { await exportPoster({ upi, imageFallback: q.imageDataUrl, amount: q.amount, label: q.label }, mode); }
    finally { setBusy(false); }
  }

  return (
    <div className="sq-card">
      <button className="sq-card-x" onClick={onRemove} title="Delete">×</button>
      <div className="sq-card-qr"><img src={shown} alt="" /></div>
      <div className="sq-card-amt">{rupee(q.amount)}</div>
      {q.label && <div className="sq-card-label">{q.label}</div>}
      <div className="sq-card-stat">{q.paidCount || 0} paid · {rupee(q.paidTotal || 0)}</div>
      <div className="sq-card-actions">
        <button className="an-btn tiny" disabled={busy} onClick={() => act("download")}>Download</button>
        <button className="an-btn ghost tiny" disabled={busy} onClick={() => act("share")}>Share</button>
      </div>
    </div>
  );
}

// ── All store-QR payments ───────────────────────────────────────────────────
function StoreHistory({ qrId }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    // Show the DB history INSTANTLY (no waiting on Razorpay)…
    storeQrHistory(qrId)
      .then((r) => { if (live) setItems(r?.items || []); })
      .catch((e) => { if (live) setErr(e.message || "Couldn’t load history."); });
    // …then refresh from Razorpay in the background and update if anything's new.
    storeQrSync(qrId)
      .then((r) => { if (live && Array.isArray(r?.items)) setItems(r.items); })
      .catch(() => { /* the DB view above already loaded */ });
    return () => { live = false; };
  }, [qrId]);

  if (err) return <p className="an-warn" style={{ margin: "10px 2px" }}>⚠ {err}</p>;
  if (items === null) return <p className="panel-sub">Loading…</p>;
  if (!items.length) return <p className="panel-sub">No payments yet. They’ll appear here — and the soundbox will announce them — the moment a customer pays.</p>;

  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const onSaved = (vpa, name) => setItems((xs) => xs.map((r) => r.vpa === vpa ? { ...r, name } : r));
  return (
    <div className="cq-hist">
      <div className="sq-hist-total">{items.length} payments · {rupee(total)}</div>
      {items.map((it) => (
        <div className="cq-hist-row" key={it.id}>
          <div className="cq-hist-main">
            <div className="cq-hist-top">
              <span className="cq-hist-amt">{rupee(it.amount)}</span>
              {it.label && it.label !== "Store QR" && <span className="cq-hist-label">{it.label}</span>}
            </div>
            <div className="cq-hist-sub">
              <PayerName vpa={it.vpa} name={it.name} onSaved={onSaved} />{" · "}{whenText(it.paidAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// A payer identity in a row: shows the saved name, or the UPI ID with a "+ Name"
// button. Tapping lets you name (or rename) that customer — saved against their
// UPI ID, so all their past and future payments show the name.
function PayerName({ vpa, name, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name || "");
  const [busy, setBusy] = useState(false);
  if (!vpa) return <span>UPI</span>;

  async function save() {
    setBusy(true);
    try {
      const r = await storeQrSetName(vpa, val.trim());
      onSaved?.(vpa, r?.name ?? (val.trim() || null));
      setEditing(false);
    } catch (e) { toast(e.message || "Couldn’t save the name."); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <span className="sq-name-edit">
        <input className="an-input sq-name-input" autoFocus value={val} maxLength={60}
          placeholder="Customer name" onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <button className="an-btn tiny" disabled={busy} onClick={save}>{busy ? "…" : "Save"}</button>
        <button className="an-btn ghost tiny" onClick={() => { setEditing(false); setVal(name || ""); }}>✕</button>
      </span>
    );
  }
  return name
    ? <button className="sq-name named" onClick={() => setEditing(true)}>{name} <span className="sq-name-pen">✎</span></button>
    : <button className="sq-name" onClick={() => setEditing(true)}><span className="sq-name-vpa">{vpa}</span> <span className="sq-name-add">+ Name</span></button>;
}
