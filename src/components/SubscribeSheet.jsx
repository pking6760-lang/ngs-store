import { useMemo, useState } from "react";
import { createSubscription } from "../lib/api.js";
import { toast } from "../lib/toast.js";

// Bottom sheet to turn the current cart into a daily/weekly auto-order.
// Reuses the checkout's address + location + payment; the customer only picks
// how often and at what time.
const FREQ = [
  { id: "daily", label: "Every day", dow: null },
  { id: "weekdays", label: "Mon–Sat", dow: [1, 2, 3, 4, 5, 6] },
  { id: "weekends", label: "Weekends", dow: [0, 6] },
  { id: "custom", label: "Pick days", dow: [] },
];
const DAYS = [["S", 0], ["M", 1], ["T", 2], ["W", 3], ["T", 4], ["F", 5], ["S", 6]];
const hourText = (h) => { const ap = h < 12 ? "am" : "pm"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh}:00 ${ap}`; };
// Grocery-friendly delivery hours.
const HOURS = [6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20];

export default function SubscribeSheet({ open, onClose, items, summaryProducts, address, location, payment, userId, onCreated }) {
  const [freq, setFreq] = useState("daily");
  const [custom, setCustom] = useState([]);      // selected dow when freq = custom
  const [hour, setHour] = useState(8);
  const [pay, setPay] = useState(payment === "wallet" ? "wallet" : "cod");
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    const byId = Object.fromEntries((summaryProducts || []).map((p) => [p.id, p]));
    return (items || []).map((it) => ({ name: byId[it.id]?.name || "Item", qty: it.qty }));
  }, [items, summaryProducts]);

  if (!open) return null;

  const toggleDay = (d) =>
    setCustom((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d].sort()));

  async function start() {
    if (busy) return;
    const chosen = FREQ.find((f) => f.id === freq);
    const dow = freq === "custom" ? custom : chosen.dow;
    if (freq === "custom" && custom.length === 0) { toast("Pick at least one day."); return; }
    if (!items || items.length === 0) { toast("Your cart is empty."); return; }
    setBusy(true);
    try {
      await createSubscription({ userId, items, address, location, payment: pay, dow, hour });
      toast("Subscription started 🔁 We'll auto-order for you.");
      onCreated && onCreated();
      onClose();
    } catch (e) {
      toast(e.message || "Couldn't start the subscription.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>Get this delivered 🔁</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sub-body">
          <div className="sub-items">
            {summary.map((s, i) => (
              <span key={i} className="sub-item-chip">{s.name} × {s.qty}</span>
            ))}
          </div>

          <div className="sub-field-lbl">How often</div>
          <div className="sub-freq">
            {FREQ.map((f) => (
              <button
                key={f.id}
                className={`sub-freq-btn ${freq === f.id ? "on" : ""}`}
                onClick={() => setFreq(f.id)}
              >{f.label}</button>
            ))}
          </div>
          {freq === "custom" && (
            <div className="sub-days">
              {DAYS.map(([lbl, d]) => (
                <button
                  key={d}
                  className={`sub-day ${custom.includes(d) ? "on" : ""}`}
                  onClick={() => toggleDay(d)}
                >{lbl}</button>
              ))}
            </div>
          )}

          <div className="sub-field-lbl">Deliver around</div>
          <select className="sub-select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
          </select>

          <div className="sub-field-lbl">Pay by</div>
          <div className="sub-pay">
            <button className={`sub-pay-btn ${pay === "cod" ? "on" : ""}`} onClick={() => setPay("cod")}>Cash on delivery</button>
            <button className={`sub-pay-btn ${pay === "wallet" ? "on" : ""}`} onClick={() => setPay("wallet")}>NGS Wallet</button>
          </div>

          <p className="sub-note">
            We'll place this order automatically on your chosen days and send you a heads-up each time.
            {pay === "wallet" && " If your wallet is short, we'll switch that day to cash."}
          </p>
        </div>

        <div className="sub-foot">
          <button className="sub-start" disabled={busy} onClick={start}>
            {busy ? "Starting…" : "Start subscription"}
          </button>
          <p className="sub-cancel-hint">Cancel or skip anytime from Account → Subscriptions.</p>
        </div>
      </div>
    </div>
  );
}
