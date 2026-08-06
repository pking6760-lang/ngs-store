import { useEffect, useRef, useState } from "react";
import {
  storeQrGet, storeQrList, storeQrCreateFixed, storeQrHistory, storeQrSync, storeQrRemove,
} from "../lib/api.js";
import { decodeUpiFromQr, qrDataUri } from "../lib/payments.js";
import { unlockAudio, announcePayment } from "../lib/sound.js";
import { shop } from "../data/shop.js";
import { toast } from "../lib/toast.js";
import { Ic } from "./AdminIcons.jsx";

const STORE_NAME = (shop && shop.name) || "NGS Store";
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const whenText = (ms) => ms ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

// Draw a clean, printable poster: store name, big QR, and the amount line.
// Returns { dataUrl, blob }. Prefers redrawing the QR crisp from the decoded UPI
// string; falls back to Razorpay's PNG if we couldn't decode it.
async function makePoster({ upi, imageFallback, amount, label }) {
  const W = 880, H = 1180;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  // Header band
  ctx.fillStyle = "#c92a2a"; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "700 46px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(STORE_NAME, W / 2, 78);
  ctx.font = "500 26px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("Scan & Pay with any UPI app", W / 2, 118);

  // QR image
  const src = upi ? qrDataUri(upi, 14, 2) : imageFallback;
  if (src) {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
    }).catch(() => null);
    if (img) {
      const box = 560, x = (W - box) / 2, y = 220;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#eaeaea"; ctx.lineWidth = 2;
      ctx.fillRect(x - 24, y - 24, box + 48, box + 48);
      ctx.strokeRect(x - 24, y - 24, box + 48, box + 48);
      ctx.drawImage(img, x, y, box, box);
    }
  }

  // Amount line
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  if (amount != null) {
    ctx.font = "800 78px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(rupee(amount), W / 2, 900);
    if (label) {
      ctx.fillStyle = "#666"; ctx.font = "500 30px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(label, W / 2, 946);
    }
  } else {
    ctx.font = "800 52px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("Enter any amount", W / 2, 892);
    ctx.fillStyle = "#666"; ctx.font = "500 30px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("The customer types the amount and pays", W / 2, 940);
  }

  // UPI app icons row (text badges — keeps the poster self-contained)
  ctx.fillStyle = "#8a8a8a"; ctx.font = "600 26px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("GPay   ·   PhonePe   ·   Paytm   ·   BHIM", W / 2, 1030);

  // Footer
  ctx.fillStyle = "#c92a2a"; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = "#ffffff"; ctx.font = "600 26px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("Powered by " + STORE_NAME, W / 2, H - 27);

  const dataUrl = c.toDataURL("image/png");
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return { dataUrl, blob };
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// Download or share a QR poster. Share uses the native sheet when available.
async function exportPoster({ upi, imageFallback, amount, label }, mode) {
  const { dataUrl, blob } = await makePoster({ upi, imageFallback, amount, label });
  const namePart = amount != null ? `${amount}` : "open";
  const filename = `${STORE_NAME.replace(/\s+/g, "-")}-QR-${namePart}.png`;
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
  const poll = useRef(null);

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

  function stopPolling() { if (poll.current) { clearInterval(poll.current); poll.current = null; } }
  function startPolling(qrId) {
    stopPolling();
    poll.current = setInterval(async () => {
      try {
        const r = await storeQrSync(qrId);
        const items = r?.items || [];
        // Announce any payment we haven't seen since this screen opened.
        const fresh = items.filter((it) => it.paymentId && !seen.current.has(it.paymentId));
        fresh.reverse().forEach((it) => {
          seen.current.add(it.paymentId);
          if (localStorage.getItem("ngs_sb_on") !== "0") {
            announcePayment(it.amount, localStorage.getItem("ngs_sb_lang") || "en-IN");
          }
        });
        setRecent(items.slice(0, 6));
      } catch { /* keep polling */ }
    }, 4000);
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
      <div className="sq-any">Scan &amp; enter any amount</div>
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
                <div className="cq-hist-sub">{it.vpa || it.contact || "UPI"} · {whenText(it.paidAt)}</div>
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
    storeQrSync(qrId)                                  // sync first so it's fresh
      .then((r) => { if (live) setItems(r?.items || []); })
      .catch(() => storeQrHistory(qrId)
        .then((r) => { if (live) setItems(r?.items || []); })
        .catch((e) => { if (live) setErr(e.message || "Couldn’t load history."); }));
    return () => { live = false; };
  }, [qrId]);

  if (err) return <p className="an-warn" style={{ margin: "10px 2px" }}>⚠ {err}</p>;
  if (items === null) return <p className="panel-sub">Loading…</p>;
  if (!items.length) return <p className="panel-sub">No payments yet. They’ll appear here — and the soundbox will announce them — the moment a customer pays.</p>;

  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);
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
            <div className="cq-hist-sub">{it.vpa || it.contact || "UPI"} · {whenText(it.paidAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
