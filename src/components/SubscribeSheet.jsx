import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSubscriptionOrder, createRazorpayOrder, verifyRazorpayPayment, walletBalance,
  createOrderQr, fetchOrderState, discardPendingSubscription,
} from "../lib/api.js";
import { loadRazorpay, RAZORPAY_ENABLED, cleanUpiQrFromImage, decodeUpiFromQr } from "../lib/payments.js";
import UpiPayScreen from "./UpiPayScreen.jsx";
import { toast } from "../lib/toast.js";
import { tr } from "../lib/i18n.jsx";

// Prepaid subscription sheet: choose days, pay upfront (Wallet = instant, Online
// = our own branded UPI QR page, same as checkout — NOT Razorpay's hosted page).
const DAY_PRESETS = [7, 15, 30];
const hourText = (h) => { const ap = h < 12 ? "am" : "pm"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh}:00 ${ap}`; };
const HOURS = [6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20];

export default function SubscribeSheet({ open, onClose, items, summaryProducts, dailyTotal, deliveryFee = 10, address, location, user, onCreated }) {
  const [days, setDays] = useState(7);
  const [hour, setHour] = useState(8);
  const [pay, setPay] = useState("wallet");
  const [busy, setBusy] = useState(false);
  const [walletBal, setWalletBal] = useState(null); // null = still loading
  // Online-pay (custom QR) state
  const [mode, setMode] = useState("form");          // 'form' | 'pay'
  const [order, setOrder] = useState(null);
  const [qr, setQr] = useState("loading");           // 'loading' | 'error' | { url }
  const [upiIntent, setUpiIntent] = useState("");
  const [payErr, setPayErr] = useState("");
  const [paying, setPaying] = useState(false);
  const rzpRef = useRef(null);

  const perItems = Math.round(dailyTotal || 0);
  const fee = Math.round(deliveryFee || 0);
  const perDay = perItems + fee;
  const total = perDay * days;
  const walletKnown = walletBal != null;
  const walletEnough = !walletKnown || walletBal >= total;

  const summary = useMemo(() => {
    const byId = Object.fromEntries((summaryProducts || []).map((p) => [p.id, p]));
    return (items || []).map((it) => ({ name: byId[it.id]?.name || tr("Item"), qty: it.qty }));
  }, [items, summaryProducts]);

  // Load wallet balance on open; reset everything when closed.
  useEffect(() => {
    if (!open) { setMode("form"); setOrder(null); setQr("loading"); setPaying(false); setPayErr(""); return; }
    let alive = true;
    setWalletBal(null);
    walletBalance().then((b) => { if (alive) setWalletBal(Number(b) || 0); })
      .catch(() => { if (alive) setWalletBal(0); });
    return () => { alive = false; };
  }, [open]);

  // Don't strand the customer on wallet when it can't cover the plan.
  useEffect(() => {
    if (walletKnown && !walletEnough && pay === "wallet" && RAZORPAY_ENABLED) setPay("razorpay");
  }, [walletKnown, walletEnough, pay]);

  // Once we're on the pay screen: fetch our own UPI QR and warm the SDK.
  useEffect(() => {
    if (mode !== "pay" || !order) return;
    let alive = true;
    setQr("loading");
    loadRazorpay().catch(() => {});
    (async () => {
      try {
        createRazorpayOrder(order.dbId).then((rp) => { if (alive) rzpRef.current = rp; }).catch(() => {});
        const { imageUrl, imageDataUrl } = await createOrderQr(order.dbId);
        const clean = await cleanUpiQrFromImage(imageDataUrl).catch(() => null);
        const intent = await decodeUpiFromQr(imageDataUrl).catch(() => "");
        if (alive) { setUpiIntent(intent); setQr({ url: clean || imageDataUrl || imageUrl }); }
      } catch (e) {
        if (alive) { setPayErr(e.message || "Couldn't start the payment."); setQr("error"); }
      }
    })();
    return () => { alive = false; };
  }, [mode, order]);

  // Poll until the advance payment confirms → the plan activates server-side.
  useEffect(() => {
    if (mode !== "pay" || !order) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const st = await fetchOrderState(order.dbId);
        if (alive && st?.payment_status === "paid") {
          clearInterval(iv);
          toast("Plan started 🥛 First delivery tomorrow!");
          onCreated && onCreated();
          onClose();
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [mode, order]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function start() {
    if (busy) return;
    if (!items || items.length === 0) { toast(tr("Your cart is empty.")); return; }
    if (days < 1) { toast(tr("Choose how many days.")); return; }
    setBusy(true);
    try {
      const o = await createSubscriptionOrder({ items, days, hour, address, location, pay });
      if (pay === "wallet") {
        toast("Plan started 🥛 First delivery tomorrow!");
        onCreated && onCreated();
        onClose();
      } else {
        setOrder(o);
        setMode("pay");     // show OUR branded QR page, not Razorpay's
      }
    } catch (e) {
      toast(e.message || tr("Couldn't start the plan."));
    } finally {
      setBusy(false);
    }
  }

  // Card / other-methods fallback → Razorpay sheet (same as checkout).
  async function payOnThisPhone() {
    if (!order || paying) return;
    setPayErr(""); setPaying(true);
    try {
      const rp = rzpRef.current || (await createRazorpayOrder(order.dbId));
      rzpRef.current = rp;
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: `${days}-day plan`,
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#0a9155" },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (resp) => {
          setPaying(false);
          try {
            await verifyRazorpayPayment({
              orderId: order.dbId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
          } catch { /* the polling effect / webhook still confirms it */ }
        },
      });
      rzp.on("payment.failed", (r) => { setPaying(false); setPayErr(r?.error?.description || "Payment failed."); });
      rzp.open();
    } catch (e) {
      setPayErr(e.message || "Couldn't open the payment."); setPaying(false);
    }
  }

  function handleClose() {
    // Left the pay screen without paying → drop the unpaid plan + its order so it
    // never lingers in Subscriptions.
    if (mode === "pay" && order?.subscriptionId) discardPendingSubscription(order.subscriptionId);
    onClose();
  }

  return (
    <div className="sheet-overlay" onClick={handleClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>{mode === "pay" ? "Pay for your plan" : "Subscribe & prepay 🔁"}</h3>
          <button className="drawer-close" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        {mode === "pay" ? (
          <div className="sub-body">
            <UpiPayScreen
              amount={total}
              loading={qr === "loading"}
              qrSrc={qr && qr.url ? qr.url : null}
              upiIntent={upiIntent}
              onRazorpay={payOnThisPhone}
              error={qr === "error" ? payErr : payErr}
              note="Your plan starts the moment payment confirms — first delivery tomorrow."
            />
            <button className="ghost-btn full" onClick={handleClose} style={{ marginTop: 10 }}>{tr("Cancel")}</button>
          </div>
        ) : (
          <>
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
                  <input type="number" min="1" max="30" placeholder="Custom"
                    value={DAY_PRESETS.includes(days) ? "" : days}
                    onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
                  <span>days</span>
                </label>
              </div>

              <div className="sub-field-lbl">{tr("Deliver around")}</div>
              <select className="sub-select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
              </select>

              <div className="sub-field-lbl">{tr("Pay in advance by")}</div>
              <div className="sub-pay">
                <button
                  className={`sub-pay-btn ${pay === "wallet" ? "on" : ""} ${walletKnown && !walletEnough ? "low" : ""}`}
                  disabled={walletKnown && !walletEnough}
                  onClick={() => setPay("wallet")}
                >
                  NGS Wallet{walletKnown ? ` · ₹${Math.round(walletBal)}` : ""}
                </button>
                {RAZORPAY_ENABLED && (
                  <button className={`sub-pay-btn ${pay === "razorpay" ? "on" : ""}`} onClick={() => setPay("razorpay")}>{tr("Pay online")}</button>
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
                <div className="sub-total-line"><span>{tr("Convenience fee")}</span><span>₹{fee}/day</span></div>
                <div className="sub-total-row"><span>₹{perDay}/day × {days} days</span><strong>₹{total}</strong></div>
                <div className="sub-total-note">First delivery tomorrow. Add items to any day's delivery from the cart.</div>
              </div>
            </div>

            <div className="sub-foot">
              <button
                className="sub-start"
                disabled={busy || (walletKnown && !walletEnough && !RAZORPAY_ENABLED)}
                onClick={start}
              >
                {busy ? "Starting…" : `Pay ₹${total} & start`}
              </button>
              <p className="sub-cancel-hint">Cancel anytime from Account → Subscriptions; unused days are refunded to your wallet.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
