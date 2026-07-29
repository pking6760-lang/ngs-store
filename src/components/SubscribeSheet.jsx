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
  // Default to auto-pay: pay one day at a time from the wallet, not the whole
  // plan up front.
  const [pay, setPay] = useState("wallet_daily");
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
  const autopay = pay === "wallet_daily";
  // Auto-pay only needs one day's cost in the wallet to start; prepay needs the
  // whole plan.
  const needAmount = autopay ? perDay : total;
  const walletKnown = walletBal != null;
  const walletEnough = !walletKnown || walletBal >= needAmount;

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
      if (pay === "wallet" || pay === "wallet_daily") {
        toast(pay === "wallet_daily"
          ? "Auto-pay started 🥛 We'll draw ₹" + perDay + "/day from your wallet."
          : "Plan started 🥛 First delivery tomorrow!");
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
          <h3>{mode === "pay" ? "Pay for your plan" : "Subscribe 🔁"}</h3>
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

              <div className="sub-field-lbl">{tr("How to pay")}</div>
              <div className="sub-paymodes">
                <button
                  type="button"
                  className={`sub-paymode ${autopay ? "on" : ""}`}
                  onClick={() => setPay("wallet_daily")}
                >
                  <span className="sub-paymode-top">
                    <b>{tr("Auto-pay daily")}</b>
                    <span className="sub-paymode-tag">{tr("Recommended")}</span>
                  </span>
                  <span className="sub-paymode-sub">₹{perDay}/day from your wallet — pay only for what's delivered.</span>
                </button>
                <button
                  type="button"
                  className={`sub-paymode ${pay === "wallet" ? "on" : ""}`}
                  onClick={() => setPay("wallet")}
                >
                  <span className="sub-paymode-top"><b>{tr("Prepay the plan")}</b></span>
                  <span className="sub-paymode-sub">₹{total} now from wallet for all {days} days.</span>
                </button>
                {RAZORPAY_ENABLED && (
                  <button
                    type="button"
                    className={`sub-paymode ${pay === "razorpay" ? "on" : ""}`}
                    onClick={() => setPay("razorpay")}
                  >
                    <span className="sub-paymode-top"><b>{tr("Prepay online")}</b></span>
                    <span className="sub-paymode-sub">₹{total} now via UPI for all {days} days.</span>
                  </button>
                )}
              </div>
              {walletKnown && (
                <p className={`sub-pay-hint ${!walletEnough ? "warn" : ""}`}>
                  {tr("NGS Wallet")}: ₹{Math.round(walletBal)}
                  {!walletEnough && (autopay
                    ? ` — add at least ₹${perDay} to start auto-pay.`
                    : ` — not enough to prepay ₹${total}.`)}
                </p>
              )}

              <div className="sub-total">
                <div className="sub-total-line"><span>Items</span><span>₹{perItems}/day</span></div>
                <div className="sub-total-line"><span>{tr("Convenience fee")}</span><span>₹{fee}/day</span></div>
                <div className="sub-total-row">
                  <span>₹{perDay}/day × {days} days</span>
                  <strong>{autopay ? `₹${perDay}/day` : `₹${total}`}</strong>
                </div>
                <div className="sub-total-note">
                  {autopay
                    ? `Nothing charged up front — we draw ₹${perDay} the day before each delivery. First delivery tomorrow.`
                    : "First delivery tomorrow. Add items to any day's delivery from the cart."}
                </div>
              </div>
            </div>

            <div className="sub-foot">
              <button
                className="sub-start"
                disabled={busy || ((autopay || pay === "wallet") && walletKnown && !walletEnough)}
                onClick={start}
              >
                {busy ? "Starting…" : autopay ? `Start auto-pay` : pay === "wallet" ? `Pay ₹${total} & start` : `Continue · ₹${total}`}
              </button>
              <p className="sub-cancel-hint">
                {autopay
                  ? "Cancel anytime from Account → Subscriptions. You only ever pay for days delivered."
                  : "Cancel anytime from Account → Subscriptions; unused days are refunded to your wallet."}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
