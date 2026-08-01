import { useEffect, useRef, useState } from "react";
import { collectQrCreate, collectQrStatus } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// POS "collect payment": type an amount → show a UPI QR the customer scans →
// the moment they pay, the QR closes itself and the payer's details appear.
export default function CollectQR() {
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("entry"); // entry · waiting · paid · expired
  const [qr, setQr] = useState(null);           // { qrId, imageDataUrl, imageUrl, amount, closeBy }
  const [payment, setPayment] = useState(null);  // { amount, vpa, contact, method, createdAt }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(0);           // seconds until the QR lapses
  const poll = useRef(null);
  const tick = useRef(null);

  function stopTimers() {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
  }
  useEffect(() => stopTimers, []);

  async function createQr() {
    const rupees = Number(amount);
    if (!(rupees > 0)) { setErr("Enter an amount first."); return; }
    setBusy(true); setErr("");
    try {
      const q = await collectQrCreate(rupees);
      if (q?.error) throw new Error(q.error);
      setQr(q); setStage("waiting"); setPayment(null);
      setLeft(Math.max(0, Math.round((q.closeBy * 1000 - Date.now()) / 1000)));
      startWaiting(q.qrId, q.closeBy);
    } catch (e) { setErr(e.message || "Couldn't create the QR."); }
    finally { setBusy(false); }
  }

  function startWaiting(qrId, closeBy) {
    stopTimers();
    tick.current = setInterval(() => {
      const s = Math.max(0, Math.round((closeBy * 1000 - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) { stopTimers(); setStage("expired"); }
    }, 1000);
    poll.current = setInterval(async () => {
      try {
        const r = await collectQrStatus(qrId);
        if (r?.paid) { stopTimers(); setPayment(r.payment); setStage("paid"); }
        else if (r?.closed) { stopTimers(); setStage("expired"); }
      } catch { /* keep polling */ }
    }, 3500);
  }

  function reset() {
    stopTimers();
    setStage("entry"); setQr(null); setPayment(null); setErr(""); setAmount("");
  }

  const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const whenText = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <section className="panel">
      <h3>Collect payment</h3>
      <p className="panel-sub">
        Type an amount and show the QR. The customer scans it with any UPI app; the moment they pay, it closes by itself and you see who paid.
      </p>

      {err && <p className="an-warn" style={{ margin: "4px 2px 10px" }}>⚠ {err}</p>}

      {stage === "entry" && (
        <div className="cq-entry">
          <label className="cq-amount">
            <span className="cq-cur">₹</span>
            <input
              type="number" inputMode="decimal" min="1" step="1" autoFocus
              placeholder="0" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createQr(); }}
            />
          </label>
          <div className="cq-quick">
            {[50, 100, 200, 500].map((v) => (
              <button key={v} className="cq-chip" onClick={() => setAmount(String(v))}>₹{v}</button>
            ))}
          </div>
          <button className="an-btn cq-go" disabled={busy || !(Number(amount) > 0)} onClick={createQr}>
            {busy ? "Creating…" : "Create QR"}
          </button>
        </div>
      )}

      {stage === "waiting" && qr && (
        <div className="cq-wait">
          <div className="cq-qwrap">
            <img className="cq-qr" src={qr.imageDataUrl || qr.imageUrl} alt="Scan to pay" />
          </div>
          <div className="cq-amt-big">{rupee(qr.amount)}</div>
          <div className="cq-status">
            <span className="cq-dot" /> Waiting for payment · closes in {mmss(left)}
          </div>
          <p className="cq-hint">Ask the customer to scan with Google Pay, PhonePe, Paytm or any UPI app.</p>
          <button className="an-btn ghost" onClick={reset}>Cancel</button>
        </div>
      )}

      {stage === "paid" && payment && (
        <div className="cq-done">
          <div className="cq-tick"><Ic name="check" size={34} /></div>
          <div className="cq-paid-amt">{rupee(payment.amount)} received</div>
          <div className="cq-receipt">
            {payment.vpa && <Row k="Paid by" v={payment.vpa} />}
            {payment.contact && <Row k="Phone" v={payment.contact} />}
            {payment.method && <Row k="Method" v={String(payment.method).toUpperCase()} />}
            {payment.createdAt && <Row k="Time" v={whenText(payment.createdAt)} />}
            {payment.paymentId && <Row k="Ref" v={payment.paymentId} />}
          </div>
          <button className="an-btn cq-go" onClick={reset}>New payment</button>
        </div>
      )}

      {stage === "expired" && (
        <div className="cq-done">
          <div className="cq-expired"><Ic name="reset" size={30} /></div>
          <div className="cq-paid-amt" style={{ color: "#6b7482" }}>QR expired</div>
          <p className="cq-hint">No payment was received in time. Create a fresh QR to try again.</p>
          <button className="an-btn cq-go" onClick={reset}>New payment</button>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }) {
  return (
    <div className="cq-row">
      <span className="cq-row-k">{k}</span>
      <span className="cq-row-v">{v}</span>
    </div>
  );
}
