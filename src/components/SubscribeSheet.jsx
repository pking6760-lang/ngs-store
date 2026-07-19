import { useEffect, useMemo, useState } from "react";
import { createSubscriptionOrder, createRazorpayOrder, verifyRazorpayPayment, walletBalance } from "../lib/api.js";
import { loadRazorpay, RAZORPAY_ENABLED } from "../lib/payments.js";
import { toast } from "../lib/toast.js";

// Prepaid subscription sheet: choose how many days, pay the whole plan upfront
// (Wallet or Online). Deliveries start tomorrow; the first order is created the
// moment payment lands, the rest the evening before each day.
const DAY_PRESETS = [7, 15, 30];
const hourText = (h) => { const ap = h < 12 ? "am" : "pm"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh}:00 ${ap}`; };
const HOURS = [6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20];

export default function SubscribeSheet({ open, onClose, items, summaryProducts, dailyTotal, deliveryFee = 10, address, location, payment, user, onCreated }) {
  const [days, setDays] = useState(7);
  const [hour, setHour] = useState(8);
  const [pay, setPay] = useState("wallet");
  const [busy, setBusy] = useState(false);
  const [walletBal, setWalletBal] = useState(null); // null = still loading

  const perItems = Math.round(dailyTotal || 0);
  const fee = Math.round(deliveryFee || 0);
  const perDay = perItems + fee;          // items + convenience fee
  const total = perDay * days;
  const walletKnown = walletBal != null;
  const walletEnough = !walletKnown || walletBal >= total;

  const summary = useMemo(() => {
    const byId = Object.fromEntries((summaryProducts || []).map((p) => [p.id, p]));
    return (items || []).map((it) => ({ name: byId[it.id]?.name || "Item", qty: it.qty }));
  }, [items, summaryProducts]);

  // Load the wallet balance when the sheet opens, so we can show it and never
  // strand the customer on a payment method that can't cover the plan.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setWalletBal(null);
    walletBalance().then((b) => { if (alive) setWalletBal(Number(b) || 0); })
      .catch(() => { if (alive) setWalletBal(0); });
    return () => { alive = false; };
  }, [open]);

  // If the wallet can't cover the plan, switch to online automatically.
  useEffect(() => {
    if (walletKnown && !walletEnough && pay === "wallet" && RAZORPAY_ENABLED) setPay("razorpay");
  }, [walletKnown, walletEnough, pay]);

  if (!open) return null;

  async function start() {
    if (busy) return;
    if (!items || items.length === 0) { toast("Your cart is empty."); return; }
    if (days < 1) { toast("Choose how many days."); return; }
    setBusy(true);
    try {
      const order = await createSubscriptionOrder({ items, days, hour, address, location, pay });
      if (pay === "wallet") {
        toast("Plan started 🥛 First delivery tomorrow!");
        onCreated && onCreated();
        onClose();
        return;
      }
      // Online: pay the advance via Razorpay, then the plan activates server-side.
      const rp = await createRazorpayOrder(order.dbId);
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: `${days}-day plan`,
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#0a9155" },
        handler: async (resp) => {
          try {
            await verifyRazorpayPayment({
              orderId: order.dbId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast("Plan started 🥛 First delivery tomorrow!");
            onCreated && onCreated();
            onClose();
          } catch {
            toast("Payment received — your plan will start shortly.");
            onClose();
          }
        },
      });
      rzp.on("payment.failed", (r) => toast(r?.error?.description || "Payment failed."));
      rzp.open();
    } catch (e) {
      toast(e.message || "Couldn't start the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>Subscribe &amp; prepay 🔁</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sub-body">
          <div className="sub-items">
            {summary.map((s, i) => (
              <span key={i} className="sub-item-chip">{s.name} × {s.qty}</span>
            ))}
          </div>

          <div className="sub-field-lbl">How many days</div>
          <div className="sub-freq">
            {DAY_PRESETS.map((d) => (
              <button key={d} className={`sub-freq-btn ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
            <label className={`sub-freq-btn sub-days-custom ${!DAY_PRESETS.includes(days) ? "on" : ""}`}>
              <input type="number" min="1" max="30" placeholder="Other"
                value={DAY_PRESETS.includes(days) ? "" : days}
                onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              <span>days</span>
            </label>
          </div>

          <div className="sub-field-lbl">Deliver around</div>
          <select className="sub-select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
          </select>

          <div className="sub-field-lbl">Pay in advance by</div>
          <div className="sub-pay">
            <button
              className={`sub-pay-btn ${pay === "wallet" ? "on" : ""} ${walletKnown && !walletEnough ? "low" : ""}`}
              disabled={walletKnown && !walletEnough}
              onClick={() => setPay("wallet")}
            >
              NGS Wallet{walletKnown ? ` · ₹${Math.round(walletBal)}` : ""}
            </button>
            {RAZORPAY_ENABLED && (
              <button className={`sub-pay-btn ${pay === "razorpay" ? "on" : ""}`} onClick={() => setPay("razorpay")}>Pay online</button>
            )}
          </div>
          {walletKnown && !walletEnough && (
            <p className="sub-pay-hint">
              Wallet has ₹{Math.round(walletBal)} — not enough for this plan.{" "}
              {RAZORPAY_ENABLED ? "Paying online instead." : "Add money to your wallet to start."}
            </p>
          )}

          <div className="sub-total">
            <div className="sub-total-line"><span>Items</span><span>₹{perItems}/day</span></div>
            <div className="sub-total-line"><span>Convenience fee</span><span>₹{fee}/day</span></div>
            <div className="sub-total-row"><span>₹{perDay}/day × {days} days</span><strong>₹{total}</strong></div>
            <div className="sub-total-note">First delivery tomorrow. Add items to any day's delivery from the cart.</div>
          </div>
        </div>

        <div className="sub-foot">
          <button className="sub-start" disabled={busy} onClick={start}>
            {busy ? "Starting…" : `Pay ₹${total} & start`}
          </button>
          <p className="sub-cancel-hint">Cancel anytime from Account → Subscriptions; unused days are refunded to your wallet.</p>
        </div>
      </div>
    </div>
  );
}
