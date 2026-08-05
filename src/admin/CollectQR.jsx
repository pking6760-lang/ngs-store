import { useEffect, useRef, useState } from "react";
import { collectQrCreate, collectQrStatus, collectQrClose, collectQrHistory } from "../lib/api.js";
import { cleanUpiQrFromImage } from "../lib/payments.js";
import { Ic } from "./AdminIcons.jsx";

// POS "collect payment": type an amount → show a UPI QR the customer scans →
// the moment they pay, the QR closes itself and the payer's details appear.
export default function CollectQR() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");         // optional: who it's for (your own record)
  const [stage, setStage] = useState("entry"); // entry · waiting · paid
  const [qr, setQr] = useState(null);           // { qrId, imageDataUrl, imageUrl, cleanQr, amount, note }
  const [payment, setPayment] = useState(null);  // { amount, vpa, contact, method, createdAt }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("collect");   // collect · history
  const poll = useRef(null);

  function stopPoll() {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
  }
  useEffect(() => stopPoll, []);

  async function createQr() {
    const rupees = Number(amount);
    if (!(rupees > 0)) { setErr("Enter an amount first."); return; }
    setBusy(true); setErr("");
    try {
      const q = await collectQrCreate(rupees, note.trim());
      if (q?.error) throw new Error(q.error);
      // Redraw a clean, plain QR from the UPI code inside Razorpay's branded
      // image — same as the order-collection flow, so no Razorpay artwork shows.
      const cleanQr = await cleanUpiQrFromImage(q.imageDataUrl);
      setQr({ ...q, cleanQr, note: note.trim() }); setStage("waiting"); setPayment(null);
      startWaiting(q.qrId);
    } catch (e) { setErr(e.message || "Couldn't create the QR."); }
    finally { setBusy(false); }
  }

  // No time limit: the QR stays live until the customer pays. We just keep
  // checking for the payment.
  function startWaiting(qrId) {
    stopPoll();
    poll.current = setInterval(async () => {
      try {
        const r = await collectQrStatus(qrId);
        if (r?.paid) { stopPoll(); setPayment(r.payment); setStage("paid"); }
      } catch { /* keep polling */ }
    }, 1500);
  }

  function cancel() {
    stopPoll();
    if (qr?.qrId) collectQrClose(qr.qrId).catch(() => {}); // stop it being payable later
    reset();
  }
  function reset() {
    stopPoll();
    setStage("entry"); setQr(null); setPayment(null); setErr(""); setAmount(""); setNote("");
  }

  const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const whenText = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <section className="panel">
      <h3>Collect payment</h3>

      <div className="cq-tabs">
        <button className={`cq-tab ${tab === "collect" ? "on" : ""}`}
          onClick={() => { setTab("collect"); if (stage !== "waiting") reset(); }}>New payment</button>
        <button className={`cq-tab ${tab === "history" ? "on" : ""}`}
          onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "history" ? (
        <CollectHistory />
      ) : (
      <>
      {stage === "entry" && (
        <p className="panel-sub">
          Type an amount and show the QR. The customer scans it with any UPI app; the moment they pay, it closes by itself and you see who paid.
        </p>
      )}

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
          <input
            className="an-input cq-note" type="text" maxLength={120}
            placeholder="Name or note (optional) — for your record"
            value={note} onChange={(e) => setNote(e.target.value)}
          />
          <button className="an-btn cq-go" disabled={busy || !(Number(amount) > 0)} onClick={createQr}>
            {busy ? "Creating…" : "Create QR"}
          </button>
        </div>
      )}

      {stage === "waiting" && qr && (
        <div className="cq-wait">
          <div className="cq-qwrap">
            <img className="cq-qr" src={qr.cleanQr || qr.imageDataUrl || qr.imageUrl} alt="Scan to pay" />
          </div>
          <div className="cq-amt-big">{rupee(qr.amount)}</div>
          {qr.note && <div className="cq-for">for {qr.note}</div>}
          <div className="cq-status">
            <span className="cq-dot" /> Waiting for payment…
          </div>
          <p className="cq-hint">Ask the customer to scan with Google Pay, PhonePe, Paytm or any UPI app.</p>
          <button className="an-btn ghost" onClick={cancel}>Cancel</button>
        </div>
      )}

      {stage === "paid" && payment && (
        <div className="cq-done">
          <div className="cq-tick"><Ic name="check" size={34} /></div>
          <div className="cq-paid-amt">{rupee(payment.amount)} received</div>
          <div className="cq-receipt">
            {qr?.note && <Row k="For" v={qr.note} />}
            {payment.vpa && <Row k="Paid by" v={payment.vpa} />}
            {payment.contact && <Row k="Phone" v={payment.contact} />}
            {payment.email && <Row k="Email" v={payment.email} />}
            {payment.method && <Row k="Method" v={String(payment.method).toUpperCase()} />}
            {payment.createdAt && <Row k="Time" v={whenText(payment.createdAt)} />}
            {payment.paymentId && <Row k="Ref" v={payment.paymentId} />}
          </div>
          <button className="an-btn cq-go" onClick={reset}>New payment</button>
        </div>
      )}
      </>
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

// Past counter collections — who paid, how much, when.
function CollectHistory() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    collectQrHistory()
      .then((r) => { if (live) setItems(r?.items || []); })
      .catch((e) => { if (live) setErr(e.message || "Couldn't load history."); });
    return () => { live = false; };
  }, []);

  const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const when = (ms) => ms ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

  if (err) return <p className="an-warn" style={{ margin: "10px 2px" }}>⚠ {err}</p>;
  if (items === null) return <p className="panel-sub">Loading…</p>;
  if (!items.length) return <p className="panel-sub">No payments collected yet. They’ll appear here the moment a customer pays.</p>;

  return (
    <div className="cq-hist">
      {items.map((it) => (
        <div className="cq-hist-row" key={it.id}>
          <div className="cq-hist-main">
            <div className="cq-hist-top">
              <span className="cq-hist-amt">{rupee(it.amount)}</span>
              {it.label && <span className="cq-hist-label">{it.label}</span>}
            </div>
            <div className="cq-hist-sub">{it.vpa || it.contact || "UPI"} · {when(it.paidAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
