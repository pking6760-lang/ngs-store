import { useEffect, useMemo, useRef, useState } from "react";
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

// ── date / time helpers (local time on the shop's phone) ────────────────────
const two = (n) => String(n).padStart(2, "0");
const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const timeOf = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";
function dayLabel(key) {
  const today = dayKeyOf(Date.now());
  const yday = dayKeyOf(Date.now() - 86400000);
  if (key === today) return "Today";
  if (key === yday) return "Yesterday";
  const [Y, M, D] = key.split("-").map(Number);
  return new Date(Y, M - 1, D).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
const handleOf = (vpa) => (vpa ? String(vpa).split("@")[0] : "");
const initialOf = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();

const SearchIco = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" />
  </svg>
);
const CalIco = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" />
  </svg>
);

// ── canvas helpers for the downloadable/shareable poster ────────────────────
const FONT = "-apple-system, Segoe UI, Roboto, sans-serif";
function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
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
async function makePoster({ upi, imageFallback, amount, label }) {
  const W = 900, H = 1260, cx = W / 2;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const mono = (STORE_NAME.trim()[0] || "N").toUpperCase();

  ctx.fillStyle = "#eef0f3"; ctx.fillRect(0, 0, W, H);
  const cardX = 44, cardY = 44, cardW = W - 88, cardH = H - 88;
  ctx.save();
  ctx.shadowColor = "rgba(20,27,36,.14)"; ctx.shadowBlur = 46; ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#ffffff"; roundRect(ctx, cardX, cardY, cardW, cardH, 44); ctx.fill();
  ctx.restore();

  const badgeY = 150, badgeR = 48;
  ctx.fillStyle = BRAND; ctx.beginPath(); ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `800 46px ${FONT}`; ctx.fillText(mono, cx, badgeY + 3);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = INK; ctx.font = `800 48px ${FONT}`;
  ctx.fillText(STORE_NAME, cx, badgeY + 112);
  ctx.fillStyle = "#8a94a1"; ctx.font = `600 25px ${FONT}`;
  ctx.fillText("Scan with any UPI app", cx, badgeY + 152);

  const qs = 480;
  const frameX = cx - qs / 2 - 34, frameY = badgeY + 196;
  const frameW = qs + 68, frameH = qs + 68;
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#edeff2"; ctx.lineWidth = 2;
  roundRect(ctx, frameX, frameY, frameW, frameH, 30); ctx.fill(); ctx.stroke();

  ctx.strokeStyle = BRAND; ctx.lineWidth = 8; ctx.lineCap = "round";
  const bl = 48, off = 20;
  [[frameX + off, frameY + off, 1, 1], [frameX + frameW - off, frameY + off, -1, 1],
   [frameX + off, frameY + frameH - off, 1, -1], [frameX + frameW - off, frameY + frameH - off, -1, -1]]
    .forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + sy * bl); ctx.lineTo(x, y); ctx.lineTo(x + sx * bl, y); ctx.stroke();
    });

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

  const logos = (await Promise.all([gpayLogo, phonepeLogo, paytmLogo, bhimLogo].map(loadImg))).filter(Boolean);
  const LH = 44, gap = 44;
  const ws = logos.map((im) => LH * (im.naturalWidth / im.naturalHeight));
  const totalW = ws.reduce((a, b) => a + b, 0) + gap * Math.max(0, logos.length - 1);
  let lx = cx - totalW / 2;
  const ly = (amount != null ? y + 4 : frameY + frameH + 64);
  logos.forEach((im, i) => { ctx.drawImage(im, lx, ly, ws[i], LH); lx += ws[i] + gap; });

  ctx.fillStyle = "#aeb6c0"; ctx.textAlign = "center"; ctx.font = `600 22px ${FONT}`;
  ctx.fillText("Secured by UPI", cx, cardY + cardH - 42);

  const dataUrl = c.toDataURL("image/png");
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return { dataUrl, blob };
}

const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// Download or share a QR poster. Native plugins inside the app, browser APIs on web.
async function exportPoster({ upi, imageFallback, amount, label }, mode) {
  const { dataUrl, blob } = await makePoster({ upi, imageFallback, amount, label });
  const namePart = amount != null ? `${amount}` : "open";
  const filename = `${STORE_NAME.replace(/\s+/g, "-")}-QR-${namePart}.png`;

  if (IS_NATIVE) {
    const base64 = String(dataUrl).split(",")[1] || "";
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      if (mode === "share") {
        const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        const { Share } = await import("@capacitor/share");
        try {
          await Share.share({ title: `${STORE_NAME} — Pay by UPI`, text: "Scan this to pay", files: [w.uri] });
        } catch (e) { if (!/cancel/i.test(e?.message || "")) throw e; }
      } else {
        const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        const { FileOpener } = await import("@capacitor-community/file-opener");
        await FileOpener.open({ filePath: w.uri, contentType: "image/png" });
        toast("QR saved — save it to your gallery or share it from here.");
      }
    } catch (e) { toast(e?.message || "Couldn’t complete that — please try again."); }
    return;
  }

  if (mode === "share") {
    const file = blob ? new File([blob], filename, { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${STORE_NAME} — Pay by UPI`, text: "Scan to pay" });
        return;
      } catch { /* cancelled → download */ }
    }
    toast("Sharing isn’t available here — downloaded instead.");
  }
  downloadDataUrl(dataUrl, filename);
}

// ════════════════════════════════════════════════════════════════════════════
export default function StoreQR() {
  const [tab, setTab] = useState("open");   // open · fixed · history
  const [sbOn, setSbOn] = useState(() => localStorage.getItem("ngs_sb_on") !== "0");
  const [sbLang, setSbLang] = useState(() => localStorage.getItem("ngs_sb_lang") || "en-IN");

  useEffect(() => { localStorage.setItem("ngs_sb_on", sbOn ? "1" : "0"); }, [sbOn]);
  useEffect(() => { localStorage.setItem("ngs_sb_lang", sbLang); }, [sbLang]);

  function testVoice() { unlockAudio(); announcePayment(199, sbLang, "Ramesh"); }

  const TABS = [
    { id: "open", label: "Scan & Pay" },
    { id: "fixed", label: "Fixed" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="sqx">
      <div className="sqx-hero">
        <div className="sqx-hero-badge"><Ic name="qr" size={22} /></div>
        <div className="sqx-hero-tx">
          <div className="sqx-hero-title">Store QR</div>
          <div className="sqx-hero-sub">Your permanent UPI QR — customers scan &amp; pay any amount, and the soundbox announces every payment.</div>
        </div>
      </div>

      <div className="sqx-seg">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""}
            onClick={() => { unlockAudio(); setTab(t.id); }}>{t.label}</button>
        ))}
      </div>

      {tab === "open" && <OpenQr sbOn={sbOn} />}
      {tab === "fixed" && <FixedQrs />}
      {tab === "history" && <StoreHistory />}

      <div className="sqx-sb">
        <div className="sqx-sb-ico"><Ic name="broadcast" size={18} /></div>
        <div className="sqx-sb-tx">
          <div className="sqx-sb-title">Soundbox</div>
          <div className="sqx-sb-sub">{sbOn ? "Announcing payments aloud" : "Muted"}</div>
        </div>
        {sbOn && (
          <div className="sqx-sb-lang">
            <button className={sbLang === "en-IN" ? "on" : ""} onClick={() => setSbLang("en-IN")}>EN</button>
            <button className={sbLang === "hi-IN" ? "on" : ""} onClick={() => setSbLang("hi-IN")}>हिं</button>
          </div>
        )}
        <button className="sqx-sb-test" onClick={testVoice}>Test</button>
        <label className="an-switch"><input type="checkbox" checked={sbOn} onChange={(e) => setSbOn(e.target.checked)} /><span /></label>
      </div>
    </div>
  );
}

// ── Scan & Pay: the main permanent QR ───────────────────────────────────────
function OpenQr({ sbOn }) {
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const seen = useRef(new Set());
  const poll = useRef(null);
  const syncPoll = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await storeQrGet();
        const q = r?.qr;
        if (!q) throw new Error("Couldn’t load the QR.");
        const upi = await decodeUpiFromQr(q.imageDataUrl).catch(() => "");
        if (live) setQr({ ...q, upi });
        const h = await storeQrHistory(q.qrId).catch(() => ({ items: [] }));
        (h.items || []).forEach((it) => seen.current.add(it.paymentId));
        if (live) setRecent((h.items || []).slice(0, 5));
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
        setRecent(items.slice(0, 5));
      } catch { /* keep polling */ }
    };
    poll.current = setInterval(pull, 2000);
    syncPoll.current = setInterval(() => { storeQrSync(qrId).catch(() => {}); }, 7000);
  }

  const shownQr = qr && (qr.upi ? qrDataUri(qr.upi, 8, 4) : qr.imageDataUrl);

  if (err) return <div className="sqx-err">⚠ {err}</div>;
  if (!qr) return <div className="sqx-loading">Loading your store QR…</div>;

  async function doExport(mode) {
    setBusy(true);
    try { await exportPoster({ upi: qr.upi, imageFallback: qr.imageDataUrl, amount: null }, mode); }
    finally { setBusy(false); }
  }

  return (
    <div className="sqx-scan">
      <div className="sqx-qrcard">
        <div className="sqx-live"><span className="dot" /> {sbOn ? "Live · announcing" : "Soundbox off"}</div>
        <div className="sqx-qrbox"><img className="sqx-qr" src={shownQr} alt="Scan to pay" /></div>
        <div className="sqx-store">{STORE_NAME}</div>
        <div className="sqx-store-sub">Scan with any UPI app</div>
        <div className="sqx-logos">
          <img src={gpayLogo} alt="GPay" /><img src={phonepeLogo} alt="PhonePe" />
          <img src={paytmLogo} alt="Paytm" /><img src={bhimLogo} alt="BHIM" />
        </div>
        <div className="sqx-actions">
          <button className="sqx-btn primary" disabled={busy} onClick={() => doExport("download")}>
            <Ic name="download" size={17} /> Download
          </button>
          <button className="sqx-btn ghost" disabled={busy} onClick={() => doExport("share")}>
            <Ic name="share" size={17} /> Share
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="sqx-recent">
          <div className="sqx-recent-h">Recent payments</div>
          {recent.map((it) => (
            <PayRow key={it.id} it={it}
              onSaved={(vpa, name) => setRecent((rs) => rs.map((r) => r.vpa === vpa ? { ...r, name } : r))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fixed-amount QRs ────────────────────────────────────────────────────────
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
    <div className="sqx-fixed">
      <p className="sqx-hint">Make a QR for a set price — e.g. a ₹100 sticker for one item. It never expires and can be paid again and again.</p>
      {err && <div className="sqx-err">⚠ {err}</div>}

      <div className="sqx-fixform">
        <div className="sqx-amt">
          <span className="cur">₹</span>
          <input type="number" inputMode="decimal" min="1" step="1" placeholder="0"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
        </div>
        <input className="sqx-input" type="text" maxLength={80}
          placeholder="Name / item (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="sqx-btn primary full" disabled={busy || !(Number(amount) > 0)} onClick={create}>
          {busy ? "Creating…" : "Create fixed QR"}
        </button>
      </div>

      {items === null ? (
        <div className="sqx-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="sqx-empty">No fixed QRs yet.</div>
      ) : (
        <div className="sqx-grid">
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
    <div className="sqx-card">
      <button className="sqx-card-x" onClick={onRemove} title="Delete">×</button>
      <div className="sqx-card-qr"><img src={shown} alt="" /></div>
      <div className="sqx-card-amt">{rupee(q.amount)}</div>
      {q.label && <div className="sqx-card-label">{q.label}</div>}
      <div className="sqx-card-stat">{q.paidCount || 0} paid · {rupee(q.paidTotal || 0)}</div>
      <div className="sqx-card-actions">
        <button className="sqx-btn primary tiny" disabled={busy} onClick={() => act("download")}>Download</button>
        <button className="sqx-btn ghost tiny" disabled={busy} onClick={() => act("share")}>Share</button>
      </div>
    </div>
  );
}

// ── History: search + date filter + grouped-by-day ──────────────────────────
function StoreHistory() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");   // "" = all days, else YYYY-MM-DD

  useEffect(() => {
    let live = true;
    storeQrHistory(null)
      .then((r) => { if (live) setItems(r?.items || []); })
      .catch((e) => { if (live) setErr(e.message || "Couldn’t load history."); });
    storeQrSync(null)
      .then((r) => { if (live && Array.isArray(r?.items)) setItems(r.items); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const onSaved = (vpa, name) => setItems((xs) => (xs || []).map((r) => r.vpa === vpa ? { ...r, name } : r));

  const { groups, count, total } = useMemo(() => {
    const list = items || [];
    const ql = q.trim().toLowerCase();
    const filtered = list.filter((it) => {
      if (day && dayKeyOf(it.paidAt) !== day) return false;
      if (!ql) return true;
      return (it.name || "").toLowerCase().includes(ql)
        || (it.vpa || "").toLowerCase().includes(ql)
        || String(Math.round(it.amount || 0)).includes(ql);
    });
    const gmap = new Map();
    for (const it of filtered) {
      const k = dayKeyOf(it.paidAt);
      if (!gmap.has(k)) gmap.set(k, { key: k, rows: [], total: 0 });
      const g = gmap.get(k); g.rows.push(it); g.total += Number(it.amount || 0);
    }
    return {
      groups: [...gmap.values()],
      count: filtered.length,
      total: filtered.reduce((s, it) => s + Number(it.amount || 0), 0),
    };
  }, [items, q, day]);

  if (err) return <div className="sqx-err">⚠ {err}</div>;
  if (items === null) return <div className="sqx-loading">Loading…</div>;

  return (
    <div className="sqx-hist">
      <div className="sqx-summary">
        <div className="sqx-stat">
          <div className="k">{day ? dayLabel(day) : "Total received"}</div>
          <div className="v green">{rupee(total)}</div>
        </div>
        <div className="sqx-stat">
          <div className="k">Payments</div>
          <div className="v">{count}</div>
        </div>
      </div>

      <div className="sqx-tools">
        <div className="sqx-search">
          <SearchIco />
          <input placeholder="Search name, UPI or amount" value={q}
            onChange={(e) => setQ(e.target.value)} />
          {q && <button className="sqx-x" onClick={() => setQ("")}>×</button>}
        </div>
        <label className="sqx-datebtn" title="Pick a date">
          <CalIco />
          <input type="date" value={day} max={dayKeyOf(Date.now())}
            onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>

      {day && (
        <button className="sqx-daypill" onClick={() => setDay("")}>
          <CalIco /> {dayLabel(day)} <span className="clr">clear ×</span>
        </button>
      )}

      {count === 0 ? (
        <div className="sqx-empty">
          {items.length === 0
            ? "No payments yet. They’ll appear here — and the soundbox will announce them — the moment a customer pays."
            : "No payments match your search."}
        </div>
      ) : (
        groups.map((g) => (
          <div className="sqx-daygroup" key={g.key}>
            <div className="sqx-dayhead">
              <span className="d">{dayLabel(g.key)}</span>
              <span className="t">{g.rows.length} · {rupee(g.total)}</span>
            </div>
            {g.rows.map((it) => <PayRow key={it.id} it={it} onSaved={onSaved} />)}
          </div>
        ))
      )}
    </div>
  );
}

// ── One payment row (with tap-to-name) ──────────────────────────────────────
function PayRow({ it, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(it.name || "");
  const [busy, setBusy] = useState(false);
  const vpa = it.vpa;

  async function save() {
    if (!vpa) return;
    setBusy(true);
    try {
      const r = await storeQrSetName(vpa, val.trim());
      onSaved?.(vpa, r?.name ?? (val.trim() || null));
      setEditing(false);
    } catch (e) { toast(e.message || "Couldn’t save the name."); }
    finally { setBusy(false); }
  }

  const named = !!it.name;
  const avatar = initialOf(it.name || handleOf(vpa) || it.contact || "?");

  return (
    <div className="sqx-pay">
      <div className={`sqx-ava ${named ? "named" : ""}`}>{avatar}</div>

      <div className="sqx-pay-mid">
        {editing ? (
          <div className="sqx-name-edit">
            <input className="sqx-input sm" autoFocus value={val} maxLength={60} placeholder="Customer name"
              onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            <button className="sqx-btn primary tiny" disabled={busy} onClick={save}>{busy ? "…" : "Save"}</button>
            <button className="sqx-btn ghost tiny" onClick={() => { setEditing(false); setVal(it.name || ""); }}>✕</button>
          </div>
        ) : (
          <button className="sqx-pay-id" onClick={() => vpa && setEditing(true)}>
            <span className="sqx-pay-name">
              {named ? it.name : (handleOf(vpa) || "UPI")}
              {vpa && <span className="sqx-pay-pen">✎</span>}
            </span>
            <span className="sqx-pay-sub">
              {named ? vpa : (vpa ? "Tap to add name" : (it.contact || "UPI"))}
              {it.label && it.label !== "Store QR" ? ` · ${it.label}` : ""}
            </span>
          </button>
        )}
      </div>

      <div className="sqx-pay-right">
        <div className="sqx-pay-amt">{rupee(it.amount)}</div>
        <div className="sqx-pay-time">{timeOf(it.paidAt)}</div>
      </div>
    </div>
  );
}
