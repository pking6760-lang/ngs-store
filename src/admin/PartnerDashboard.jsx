import { useEffect, useState, useCallback, useRef } from "react";
import { useBackGuard } from "../lib/useBackGuard.js";
import * as api from "../lib/api.js";
import { googleMapsLink } from "../lib/location.js";
import { initPartnerPush } from "../lib/partnerPush.js";
import { unlockAudio, stopAlarm, errorBeep, okBeep } from "../lib/sound.js";
import { scanBarcode } from "../lib/scanner.js";
import { cleanUpiQrFromImage } from "../lib/payments.js";
import { useReveal, PageLoad } from "../components/Motion.jsx";
import { withMinTime } from "../lib/ux.js";
import { Ic } from "./AdminIcons.jsx";

/* ── date helpers (IST) ─────────────────────────────────────────────────── */
const IST = "Asia/Kolkata";
function istDateISO(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function istParts(iso) {
  // iso timestamp string → { dateISO, monthKey } in IST
  const d = new Date(iso);
  const dateISO = istDateISO(d);
  return { dateISO, monthKey: dateISO.slice(0, 7) };
}
function hourLabel(h) {
  const fmt = (x) => { const ap = x < 12 || x === 24 ? "AM" : "PM"; let hh = x % 12; if (hh === 0) hh = 12; return `${hh} ${ap}`; };
  return `${fmt(h)} – ${fmt(h + 2)}`;
}
function dayLabel(iso) {
  const d = new Date(iso + "T12:00:00");
  const wd = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: IST }).format(d);
  const dm = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST }).format(d);
  return { wd, dm };
}
const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/* ── icons ──────────────────────────────────────────────────────────────── */
const IC = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  slots: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  earnings: <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12h3M3 9h13" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
};

/* ═══════════════════════════════════════════════════════════════════════ */
export default function PartnerDashboard({ role, name, partner, onLogout }) {
  const [tab, setTab] = useState("home");
  useBackGuard(tab !== "home", () => setTab("home"));
  const [wallet, setWallet] = useState({ balance: 0, cashInHand: 0, ledger: [] });
  const [slots, setSlots] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [presence, setPresence] = useState({ isOnline: false, activeOrderId: null });

  const reload = useCallback(async () => {
    const [w, s, c, p] = await Promise.all([
      api.getMyWallet().catch(() => ({ balance: 0, cashInHand: 0, ledger: [] })),
      api.getMySlots().catch(() => []),
      api.getOpsConfig().catch(() => null),
      api.getMyPresence().catch(() => ({ isOnline: false, activeOrderId: null })),
    ]);
    setWallet(w); setSlots(s); setCfg(c); setPresence(p);
  }, []);

  // Live everywhere: reload the instant any of the partner's own data changes,
  // plus a light safety poll and refetch on refocus.
  useEffect(() => { initPartnerPush(); }, []);
  useEffect(() => {
    reload();
    const unsubs = ["wallet_ledger", "partner_slots", "partner_presence", "ops_config", "partner_strikes"]
      .map((t) => api.subscribeTable(t, reload));
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    const poll = setInterval(reload, 20000);
    return () => { unsubs.forEach((u) => u && u()); document.removeEventListener("visibilitychange", onVis); clearInterval(poll); };
  }, [reload]);

  const isDelivery = role === "delivery";
  const shared = { role, isDelivery, name, partner, wallet, slots, cfg, presence, setPresence, reload };
  const switching = useReveal(tab, 300, 650);

  return (
    <div className="pd">
      <div className="pd-scroll">
        {switching ? (
          <PageLoad variant="partner" text={tab} />
        ) : (
          <div className="fade-up">
            {tab === "home" && <Home {...shared} />}
            {tab === "slots" && <Slots {...shared} />}
            {tab === "earnings" && <Earnings {...shared} />}
            {tab === "wallet" && <Wallet {...shared} />}
            {tab === "profile" && <Profile {...shared} onLogout={onLogout} />}
          </div>
        )}
      </div>
      <nav className="pd-nav">
        {[["home", "Home"], ["slots", "Slots"], ["earnings", "Earnings"], ["wallet", "Wallet"], ["profile", "Profile"]].map(([k, lbl]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <svg viewBox="0 0 24 24">{IC[k]}</svg>{lbl}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* Clean monochrome QR glyph (inherits currentColor) — replaces the emoji. */
function QrGlyph() {
  return (
    <svg className="qr-glyph" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5z" />
      <path d="M13 13h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z" />
    </svg>
  );
}

/* ── swipe-to-confirm slider ────────────────────────────────────────────── */
function SlideAction({ label, onConfirm, busy, tone = "green" }) {
  const trackRef = useRef(null);
  const [x, setX] = useState(0);
  const [armed, setArmed] = useState(false);
  const st = useRef({ active: false, startX: 0, max: 0, dx: 0 });
  const KNOB = 54;

  // Reset once the action settles (parent usually swaps the view on success).
  useEffect(() => { if (!busy) { setX(0); setArmed(false); st.current.dx = 0; } }, [busy]);

  function begin(clientX) {
    if (busy) return;
    const track = trackRef.current; if (!track) return;
    st.current = { active: true, startX: clientX, max: track.clientWidth - KNOB - 8, dx: 0 };
  }
  function moveTo(clientX) {
    const s = st.current; if (!s.active) return;
    const dx = Math.max(0, Math.min(s.max, clientX - s.startX));
    s.dx = dx; setX(dx); setArmed(dx >= s.max * 0.88);
  }
  function finish() {
    const s = st.current; if (!s.active) return;
    s.active = false;
    if (s.max > 0 && s.dx >= s.max * 0.88) { setX(s.max); onConfirm?.(); }
    else { setX(0); setArmed(false); s.dx = 0; }
  }
  function onMouseDown(e) {
    begin(e.clientX);
    const mm = (ev) => moveTo(ev.clientX);
    const mu = () => { finish(); window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  }

  return (
    <div ref={trackRef} className={`pd-slide ${tone} ${armed ? "armed" : ""} ${busy ? "busy" : ""}`}>
      <div className="pd-slide-fill" style={{ width: x + KNOB }} />
      <span className="pd-slide-lbl">{busy ? "Working…" : label}</span>
      <div
        className="pd-slide-knob"
        style={{ transform: `translateX(${x}px)`, transition: st.current.active ? "none" : "transform .22s ease" }}
        onTouchStart={(e) => begin(e.touches[0].clientX)}
        onTouchMove={(e) => { e.preventDefault(); moveTo(e.touches[0].clientX); }}
        onTouchEnd={finish}
        onMouseDown={onMouseDown}
      >
        {busy ? <span className="ngs-spin" /> : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        )}
      </div>
    </div>
  );
}

function EarnBanner({ amount }) {
  return (
    <div className="pd-earn">
      <span className="pd-earn-lbl">You earn on this order</span>
      <span className="pd-earn-amt">{money(amount)}</span>
    </div>
  );
}

/* ── Incoming order — Accept only (no reject) ───────────────────────────── */
function IncomingOrder({ task, busy, onAction }) {
  const isReturn = !!task.isReturn;
  const isDelivery = task.role === "delivery";
  const code = task.code || (task.orderId || "").slice(0, 4).toUpperCase();
  return (
    <div className="pd-liveorder">
      <div className="lo-head">
        <span className={`lo-live ${isReturn ? "lo-return" : ""}`}>{isReturn ? "● RETURN PICKUP" : "● NEW ORDER"}</span>
        <span className="lo-code">#{code}</span>
      </div>
      {task.earning > 0 && <EarnBanner amount={task.earning} />}
      {isDelivery && !isReturn ? (
        <div className="lo-row">
          <span className="lo-lbl">Payment</span>
          {task.paid ? <span className="lo-paid">✓ Prepaid</span>
            : task.isCod ? <span className="lo-cod"><Ic name="cash" size={14} /> Collect {money(task.codAmount)}</span>
              : <span className="lo-paid">✓ Prepaid</span>}
        </div>
      ) : (
        <div className="lo-items">
          <span className="lo-lbl">{isReturn ? "Collect these items back" : "Pack these"}</span>
          {(task.items || []).map((it, i) => (
            <div className="lo-item" key={i}><span>{it.name}</span><span>× {it.qty}</span></div>
          ))}
        </div>
      )}
      <button className="pd-btn lo-accept" disabled={busy} onClick={() => onAction(() => api.partnerAccept(task.orderId))}>
        {busy ? <span className="ngs-spin" /> : isReturn ? <><Ic name="check" size={16} /> Accept return</> : <><Ic name="check" size={16} /> Accept order</>}
      </button>
    </div>
  );
}

/* ── Delivery run — two swipe steps: Out for delivery → Delivered ────────── */
function DeliveryRun({ task, busy, onAction }) {
  const code = task.code || (task.orderId || "").slice(0, 4).toUpperCase();
  const out = task.state === "out_for_delivery";
  const [qr, setQr] = useState(null); // null | "loading" | "error" | { url }

  async function showQr() {
    if (qr && qr !== "error") { setQr(null); return; }
    setQr("loading");
    try {
      const { imageUrl, imageDataUrl } = await api.createOrderQr(task.orderId);
      const clean = await cleanUpiQrFromImage(imageDataUrl).catch(() => null);
      setQr({ url: clean || imageDataUrl || imageUrl });
    } catch { setQr("error"); }
  }

  return (
    <div className="pd-run">
      <div className="lo-head">
        <span className="lo-live">● {out ? "ON THE WAY" : "READY TO GO"}</span>
        <span className="lo-code">#{code}</span>
      </div>
      {task.earning > 0 && <EarnBanner amount={task.earning} />}

      <div className="lo-row">
        <span className="lo-lbl">Deliver to</span>
        {task.location
          ? <a className="lo-nav" href={googleMapsLink(task.location)} target="_blank" rel="noopener noreferrer"><Ic name="pin" size={14} /> Navigate</a>
          : <span className="lo-muted">Location shared at pickup</span>}
      </div>
      <div className="lo-row">
        <span className="lo-lbl">Payment</span>
        {task.paid ? <span className="lo-paid">✓ Already paid — collect nothing</span>
          : task.isCod ? <span className="lo-cod"><Ic name="cash" size={14} /> Collect {money(task.codAmount)}</span>
            : <span className="lo-paid">✓ Prepaid</span>}
      </div>

      {!task.paid && task.isCod && (
        <>
          <button className="lo-qr-btn" onClick={showQr}>
            <QrGlyph />
            <span>{qr && qr !== "error" ? "Hide UPI QR" : "Show UPI QR — customer pays now"}</span>
          </button>
          {qr === "loading" && <div className="lo-qr-wrap"><div className="qr-spin"><span>Making secure QR…</span></div></div>}
          {qr === "error" && <div className="lo-muted" style={{ textAlign: "center" }}>Couldn't create QR. Collect cash instead.</div>}
          {qr && qr.url && (
            <div className="lo-qr-wrap">
              <div className="lo-qr"><img src={qr.url} alt="UPI QR" /></div>
              <p className="lo-qr-note">Scan with <strong>any UPI app</strong> to pay <strong>{money(task.codAmount)}</strong><br /><span>Confirms automatically</span></p>
            </div>
          )}
        </>
      )}

      {/* Two-step progress */}
      <div className="pd-steps">
        <div className={`pd-step ${out ? "done" : "on"}`}><span className="pd-step-dot" /> Out for delivery</div>
        <div className={`pd-step ${out ? "on" : ""}`}><span className="pd-step-dot" /> Delivered</div>
      </div>

      {!out ? (
        <SlideAction label="Slide to go — Out for delivery" busy={busy} tone="blue"
          onConfirm={() => onAction(() => api.partnerMarkOutForDelivery(task.orderId))} />
      ) : (
        <SlideAction label="Slide when handed over — Delivered" busy={busy} tone="green"
          onConfirm={() => onAction(() => api.partnerMarkDelivered(task.orderId))} />
      )}
    </div>
  );
}

/* ── Return run — swipe to confirm picked up ────────────────────────────── */
function ReturnRun({ task, busy, onAction }) {
  const code = task.code || (task.orderId || "").slice(0, 4).toUpperCase();
  return (
    <div className="pd-run">
      <div className="lo-head"><span className="lo-live lo-return">● RETURN PICKUP</span><span className="lo-code">#{code}</span></div>
      {task.earning > 0 && <EarnBanner amount={task.earning} />}
      <div className="lo-row">
        <span className="lo-lbl">Collect from</span>
        {task.location
          ? <a className="lo-nav" href={googleMapsLink(task.location)} target="_blank" rel="noopener noreferrer"><Ic name="pin" size={14} /> Navigate</a>
          : <span className="lo-muted">Address shared on accept</span>}
      </div>
      <div className="lo-items">
        <span className="lo-lbl">Collect these items back</span>
        {(task.items || []).map((it, i) => (<div className="lo-item" key={i}><span>{it.name}</span><span>× {it.qty}</span></div>))}
      </div>
      <SlideAction label="Slide when collected — Return picked up" busy={busy} tone="green"
        onConfirm={() => onAction(() => api.partnerMarkReturned(task.orderId))} />
    </div>
  );
}

/* ── Pick run — scan each item; wrong barcode beeps; auto-packs when done ── */
function PickRun({ task, busy, onAction }) {
  const code = task.code || (task.orderId || "").slice(0, 4).toUpperCase();
  const items = task.items || [];
  const [scanned, setScanned] = useState(() => items.map(() => 0));
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const packing = useRef(false);

  const totalUnits = items.reduce((s, it) => s + (it.qty || 1), 0);
  const doneUnits = scanned.reduce((s, n) => s + n, 0);
  const allDone = totalUnits > 0 && doneUnits >= totalUnits;

  // The moment every unit is scanned, mark packed automatically.
  useEffect(() => {
    if (!allDone || packing.current) return;
    packing.current = true;
    setMsg({ kind: "ok", text: "All items scanned — packing…" });
    onAction(() => api.partnerMarkPacked(task.orderId));
  }, [allDone]);

  async function scanOne() {
    if (scanning || busy || allDone) return;
    unlockAudio();
    setScanning(true);
    setMsg({ kind: "", text: "" });
    let raw;
    try { raw = await scanBarcode(); }
    catch (e) { setMsg({ kind: "err", text: e.message || "Couldn't open the scanner." }); setScanning(false); return; }
    setScanning(false);
    if (!raw) return; // backed out of the scanner
    const norm = String(raw).trim();
    const idx = items.findIndex((it, i) => it.barcode && String(it.barcode).trim() === norm && scanned[i] < (it.qty || 1));
    if (idx === -1) {
      errorBeep();
      const known = items.some((it) => it.barcode && String(it.barcode).trim() === norm);
      setMsg({ kind: "err", text: known ? "⚠️ That item is already fully scanned." : "❌ Wrong product — this barcode isn't in the order." });
      return;
    }
    okBeep();
    setScanned((prev) => { const next = prev.slice(); next[idx] += 1; return next; });
    setMsg({ kind: "ok", text: `✓ ${items[idx].name}` });
  }

  // Products with no barcode on file can't be scanned — let the picker tap them.
  function tapNoBarcode(i) {
    const it = items[i];
    if (it.barcode) return;
    if (scanned[i] >= (it.qty || 1)) return;
    okBeep();
    setScanned((prev) => { const next = prev.slice(); next[i] += 1; return next; });
  }

  return (
    <div className="pd-run">
      <div className="lo-head"><span className="lo-live">● PACKING</span><span className="lo-code">#{code}</span></div>
      {task.earning > 0 && <EarnBanner amount={task.earning} />}

      <div className="pd-pack-head">
        <span>Scan every item to pack</span>
        <span className="pd-pack-count">{doneUnits}/{totalUnits}</span>
      </div>

      <div className="pd-pack-list">
        {items.map((it, i) => {
          const need = it.qty || 1;
          const got = scanned[i];
          const complete = got >= need;
          return (
            <div className={`pd-pack-item ${complete ? "done" : ""}`} key={i} onClick={() => tapNoBarcode(i)}>
              <span className="pd-pack-chk">{complete ? <Ic name="check" size={15} /> : got}</span>
              <span className="pd-pack-name">{it.name}{!it.barcode && <em className="pd-pack-nobc"> · tap to add (no barcode)</em>}</span>
              <span className="pd-pack-qty">{got}/{need}</span>
            </div>
          );
        })}
      </div>

      {msg.text && <div className={`pd-scan-msg ${msg.kind}`}>{msg.text}</div>}

      {!allDone && (
        <button className="pd-btn lo-accept" disabled={scanning || busy} onClick={scanOne}>
          {scanning ? <span className="ngs-spin" /> : <><Ic name="barcode" size={18} /> Scan item</>}
        </button>
      )}
      {allDone && <div className="pd-scan-msg ok" style={{ textAlign: "center" }}>{busy ? "Marking packed…" : "Packed ✓"}</div>}
    </div>
  );
}

/* ── Home ───────────────────────────────────────────────────────────────── */
function Home({ role, isDelivery, name, wallet, slots, presence, setPresence, reload }) {
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);

  // Poll for the current assigned task while online.
  useEffect(() => {
    let alive = true;
    const tick = () => api.getMyTask().then((t) => alive && setTask(t)).catch(() => {});
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [presence.activeOrderId]);

  // Stream live GPS to the customer while on an accepted DELIVERY run, so their
  // tracking map shows the real bike position. Stops when the task ends.
  const streamOrderId = task && task.role === "delivery" && (task.state === "accepted" || task.state === "picked")
    ? task.orderId : null;
  useEffect(() => {
    if (!streamOrderId) return;
    let stop = null, alive = true, last = 0;
    import("../lib/location.js").then(({ watchLocation }) => {
      if (!alive) return;
      watchLocation((loc) => {
        const now = Date.now();
        if (now - last < 8000) return; // throttle to ~1 update / 8s
        last = now;
        api.partnerUpdateLocation(streamOrderId, loc.lat, loc.lng).catch(() => {});
      }).then((s) => { if (alive) stop = s; else s && s(); });
    });
    return () => { alive = false; if (stop) stop(); };
  }, [streamOrderId]);

  async function taskAction(fn) {
    stopAlarm(); // they're handling it — silence the ring
    setTaskBusy(true);
    try { await withMinTime(fn, 700, 1500); const t = await api.getMyTask(); setTask(t); await reload(); }
    catch (e) { alert(e.message || "Something went wrong."); }
    finally { setTaskBusy(false); }
  }

  const today = istDateISO();
  const earnings = wallet.ledger.filter((l) => l.kind === "earning");
  const todays = earnings.filter((l) => istParts(l.at).dateISO === today);
  const todayTotal = todays.reduce((s, l) => s + l.amount, 0);
  // Show the slot that's active now or coming up next today — not one that has
  // already ended. A 2-hour slot at hour h runs until h+2.
  const nowHourIST = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(new Date()), 10);
  const todaySlot = slots
    .filter((s) => s.date === today && s.status !== "cancelled" && s.hour + 2 > nowHourIST)
    .sort((a, b) => a.hour - b.hour)[0];
  const firstName = (name || "there").split(" ")[0];

  async function toggle() {
    unlockAudio(); // prime the alarm sound on this tap (browsers need a gesture)
    setBusy(true);
    try { await withMinTime(() => api.setOnline(!presence.isOnline), 450, 1000); setPresence((p) => ({ ...p, isOnline: !p.isOnline })); }
    catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <>
      <div className="pd-top">
        <div className="pd-av">{(firstName[0] || "N").toUpperCase()}</div>
        <div className="pd-who">
          <strong>Hi, {firstName}</strong>
          <span className="pd-role">{isDelivery ? <><Ic name="scooter" size={12} /> Delivery partner</> : <><Ic name="basket" size={12} /> Picker</>}</span>
        </div>
        <button className={`pd-toggle ${presence.isOnline ? "on" : "off"}`} disabled={busy} onClick={toggle}>
          {busy ? <span className="ngs-spin" /> : <span className="pd-dot" />}{presence.isOnline ? "Online" : "Offline"}
        </button>
      </div>

      <div className="pd-hero">
        <span className="badge">Today</span>
        <div className="lbl">Today's earning</div>
        <div className="amt">{money(todayTotal)}</div>
        <div className="sub">{todays.length} {isDelivery ? "deliveries" : "orders packed"} today</div>
      </div>

      <div className="pd-stats">
        <div className="pd-tile">
          <div className="t-lbl">Booked slot</div>
          <div className="t-val sm">{todaySlot ? hourLabel(todaySlot.hour) : "—"}</div>
        </div>
        <div className="pd-tile">
          <div className="t-lbl">{isDelivery ? "Delivered" : "Packed"} today</div>
          <div className="t-val">{todays.length}</div>
        </div>
      </div>

      {task ? (
        task.state === "assigned" ? (
          <IncomingOrder task={task} busy={taskBusy} onAction={taskAction} />
        ) : task.isReturn ? (
          <ReturnRun task={task} busy={taskBusy} onAction={taskAction} />
        ) : task.role === "delivery" ? (
          <DeliveryRun task={task} busy={taskBusy} onAction={taskAction} />
        ) : (
          <PickRun task={task} busy={taskBusy} onAction={taskAction} />
        )
      ) : presence.isOnline ? (
        <div className="pd-empty" style={{ border: "1px dashed var(--p-line)", borderRadius: 16, padding: 22 }}>
          <span className="emo"><Ic name="signal" size={26} /></span>
          You're online — waiting for the next order. It'll ring here the moment one comes.
        </div>
      ) : (
        <div className="pd-empty" style={{ border: "1px dashed var(--p-line)", borderRadius: 16, padding: 22 }}>
          <span className="emo"><Ic name="moon" size={26} /></span>
          You're offline. Go online in your booked slot to start receiving orders.
        </div>
      )}

      <div className="pd-sec"><span>Today's {isDelivery ? "deliveries" : "orders"}</span><span className="hint">number · earning</span></div>
      <div className="pd-list">
        {todays.length === 0 ? (
          <div className="pd-empty"><span className="emo"><Ic name="check" size={26} /></span>No orders yet today.</div>
        ) : todays.map((l) => (
          <div className="pd-row" key={l.id}>
            <div><div className="r-main">Order {l.code ? `#${l.code}` : `#${(l.orderId || "").slice(0, 4).toUpperCase()}`}</div>
              <div className="r-sub">{l.note}</div></div>
            <div className="r-amt amt-pos">+{money(l.amount)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Slots ──────────────────────────────────────────────────────────────── */
function Slots({ role, cfg, slots, reload }) {
  const [dayIdx, setDayIdx] = useState(0);
  const [counts, setCounts] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  const days = [0, 1, 2].map((n) => { const d = new Date(); d.setDate(d.getDate() + n); return istDateISO(d); });
  const dateISO = days[dayIdx];
  const openH = cfg?.storeOpenHour ?? 6, closeH = cfg?.storeCloseHour ?? 23;
  const hours = []; for (let h = 0; h <= 22; h += 2) if (h >= openH && h < closeH) hours.push(h);
  const mine = new Set(slots.filter((s) => s.date === dateISO && s.status !== "cancelled").map((s) => s.hour));
  // A slot that has already started (or passed) today can't be booked.
  const nowHourIST = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(new Date()), 10);
  const isToday = dateISO === istDateISO();

  useEffect(() => { api.getSlotCounts(dateISO).then(setCounts).catch(() => setCounts({})); }, [dateISO, busy]);

  async function book(h) {
    setErr(""); setBusy(h);
    try { await withMinTime(() => api.bookSlot(role, dateISO, h), 500, 1100); await reload(); }
    catch (e) { setErr(e.message || "Couldn't book."); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div className="pd-sec"><span>Book a 2-hour slot</span></div>
      <div className="pd-days">
        {days.map((d, i) => { const { wd, dm } = dayLabel(d); return (
          <button key={d} className={`pd-day ${i === dayIdx ? "sel" : ""}`} onClick={() => setDayIdx(i)}>
            {i === 0 ? "Today" : wd}<small>{dm}</small>
          </button>
        ); })}
      </div>
      {err && <div className="pd-err">{err}</div>}
      <div className="pd-slots">
        {hours.map((h) => {
          const booked = mine.has(h);
          const cnt = counts[`${role}:${h}`] || 0;
          const past = isToday && h <= nowHourIST;
          const full = cnt >= 10 && !booked;
          return (
            <button key={h} className={`pd-slot ${booked ? "booked" : ""} ${full || past ? "full" : ""}`}
              disabled={booked || full || past || busy === h} onClick={() => book(h)}>
              <div className="s-time">{hourLabel(h)}</div>
              <div className="s-cap">{past ? "Closed" : booked ? "✓ Booked" : full ? "Full" : busy === h ? "Booking…" : `${cnt}/10 booked`}</div>
            </button>
          );
        })}
      </div>
      <p className="pd-empty" style={{ fontSize: 12, paddingTop: 6 }}>
        Booking is a commitment — come online in your slot and complete at least one order. No cancelling.
      </p>
    </>
  );
}

/* ── Earnings ───────────────────────────────────────────────────────────── */
function mondayISO(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const wd = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}
function Earnings({ wallet }) {
  const earnings = wallet.ledger.filter((l) => l.kind === "earning");
  const payouts = wallet.ledger.filter((l) => l.kind === "payout");
  const monthKey = istDateISO().slice(0, 7);
  const monthTotal = earnings.filter((l) => istParts(l.at).monthKey === monthKey).reduce((s, l) => s + l.amount, 0);

  const byWeek = {};
  earnings.forEach((l) => {
    const wk = mondayISO(istParts(l.at).dateISO);
    byWeek[wk] = (byWeek[wk] || 0) + l.amount;
  });
  const weeks = Object.keys(byWeek).sort().reverse().slice(0, 8);
  const thisWeek = mondayISO(istDateISO());

  return (
    <>
      <div className="pd-wcard">
        <div className="lbl">This month</div>
        <div className="big">{money(monthTotal)}</div>
        <div className="note">{new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: IST }).format(new Date())}</div>
      </div>
      <div className="pd-sec"><span>Week by week</span></div>
      <div className="pd-list">
        {weeks.length === 0 ? <div className="pd-empty"><span className="emo"><Ic name="trending" size={26} /></span>No earnings yet.</div>
        : weeks.map((wk) => {
          const end = new Date(wk + "T12:00:00Z"); end.setUTCDate(end.getUTCDate() + 6);
          const endISO = end.toISOString().slice(0, 10);
          const paid = payouts.some((p) => istParts(p.at).dateISO > endISO);
          const status = wk === thisWeek ? "Current" : paid ? "Paid" : "Pending";
          const a = dayLabel(wk), b = dayLabel(endISO);
          return (
            <div className="pd-row" key={wk}>
              <div><div className="r-main">{a.dm} – {b.dm}</div>
                <div className="r-sub">{status === "Current" ? "Current week" : status === "Paid" ? "✓ Paid" : "Pending payout"}</div></div>
              <div className="r-amt amt-pos">{money(byWeek[wk])}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Wallet ─────────────────────────────────────────────────────────────── */
function Wallet({ isDelivery, wallet, cfg }) {
  const cap = cfg?.riderCashCap ?? 1000;
  const cash = wallet.cashInHand;
  const pct = Math.min(100, Math.round((cash / cap) * 100));
  const bal = wallet.balance;

  const kindLabel = { earning: "Order earned", cod_collected: "Cash collected", cod_deposited: "Cash deposited",
    payout: "Payout", penalty: "Penalty", slot_topup: "Slot top-up", adjustment: "Adjustment" };

  return (
    <>
      <div className="pd-wcard">
        <div className="lbl">Money in your wallet</div>
        <div className="big" style={{ color: bal < 0 ? "var(--p-red-bright)" : undefined }}>{money(bal)}</div>
        <div className="note">{bal < 0 ? "You owe the shop (cash held above your earnings)"
          : "What the shop owes you — becomes ₹0 after your Monday payout"}</div>
      </div>

      {isDelivery && (
        <div className="pd-wcard pd-owed">
          <div className="lbl">Cash in hand · owed to shop</div>
          <div className="big">{money(cash)}</div>
          <div className="pd-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="pd-bar-lbl"><span>{money(Math.max(0, cap - cash))} headroom left</span><span>Cap {money(cap)}</span></div>
        </div>
      )}

      <div className="pd-sec"><span>Recent activity</span></div>
      <div className="pd-wcard" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {wallet.ledger.length === 0 ? <div className="pd-empty"><span className="emo"><Ic name="wallet" size={26} /></span>No activity yet.</div>
        : wallet.ledger.slice(0, 30).map((l) => {
          const inFlow = l.amount >= 0;
          return (
            <div className="pd-led" key={l.id}>
              <div><div className="l-main">{kindLabel[l.kind] || l.kind}</div>
                <div className="l-sub">{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST }).format(new Date(l.at))}</div></div>
              <div className={`l-amt ${inFlow ? "amt-in" : "amt-out"}`}>{inFlow ? "+" : "−"}{money(Math.abs(l.amount))}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Profile ────────────────────────────────────────────────────────────── */
function Profile({ role, name, partner, onLogout }) {
  const p = partner || {};
  return (
    <>
      <div className="pd-top">
        <div className="pd-av">{(name?.[0] || "N").toUpperCase()}</div>
        <div className="pd-who"><strong>{name || "Partner"}</strong>
          <span className="pd-role">{role === "delivery" ? <><Ic name="scooter" size={12} /> Delivery partner</> : <><Ic name="basket" size={12} /> Picker</>}</span></div>
      </div>
      <div className="pd-wcard">
        {p.empCode && <div className="pd-prof-kv"><span>Employee ID</span><span className="pd-emp">{p.empCode}</span></div>}
        <div className="pd-prof-kv"><span>Status</span><span className="pd-status-ok">✓ Approved</span></div>
        <div className="pd-prof-kv"><span>Phone</span><span>{p.phone || "—"}</span></div>
        <div className="pd-prof-kv"><span>Email</span><span>{p.email || "—"}</span></div>
        <div className="pd-prof-kv"><span>Bank</span><span>{p.bankName ? `${p.bankName}` : (p.bankAccount || "—")}</span></div>
        <div className="pd-prof-kv"><span>Account</span><span>{p.bankAccount || "—"}</span></div>
        <div className="pd-prof-kv"><span>Terms</span><span>{p.termsAcceptedAt ? "✓ Accepted" : "—"}</span></div>
      </div>
      <a
        className="pd-support"
        href={`mailto:ngscustomersupport@gmail.com?subject=${encodeURIComponent(
          `NGS Partner help — ${name || "Partner"}${p.empCode ? ` (${p.empCode})` : ""}`
        )}`}
      >
        <span className="pd-support-title">Need help? Contact NGS support</span>
        <span className="pd-support-mail">ngscustomersupport@gmail.com</span>
      </a>
      <button className="pd-logout" onClick={onLogout}>Log out</button>
    </>
  );
}
