import { useEffect, useMemo, useRef, useState } from "react";
import {
  addToDelivery, walletBalance, createOrderQr, fetchOrderState, createRazorpayOrder,
  verifyRazorpayPayment,
} from "../lib/api.js";
import { loadRazorpay, RAZORPAY_ENABLED, cleanUpiQrFromImage, decodeUpiFromQr } from "../lib/payments.js";
import UpiPayScreen from "./UpiPayScreen.jsx";
import { toast } from "../lib/toast.js";
import { tr } from "../lib/i18n.jsx";

// Add the current cart to the customer's next subscription delivery. Prepaid by
// Wallet (instant) or Online (our own branded UPI QR — same as checkout). Delivery
// follows the free-over-₹199 rule; NO handling (the subscription's fee covers it).
export default function AddToDeliverySheet({
  open, onClose, upcoming, dayLabel, items, summaryProducts, itemsTotal, delivery, total, freeAbove, user, onAdded,
}) {
  const [pay, setPay] = useState("wallet");
  const [walletBal, setWalletBal] = useState(null);
  const [busy, setBusy] = useState(false);
  // Online-pay (custom QR) state
  const [mode, setMode] = useState("form");   // 'form' | 'pay'
  const [order, setOrder] = useState(null);
  const [qr, setQr] = useState("loading");    // 'loading' | 'error' | { url }
  const [upiIntent, setUpiIntent] = useState("");
  const [payErr, setPayErr] = useState("");
  const [paying, setPaying] = useState(false);
  const rzpRef = useRef(null);

  const summary = useMemo(() => {
    const byId = Object.fromEntries((summaryProducts || []).map((p) => [p.id, p]));
    return (items || []).map((it) => ({ name: byId[it.id]?.name || tr("Item"), qty: it.qty }));
  }, [items, summaryProducts]);

  const itemsR = Math.round(itemsTotal || 0);
  const delR = Math.round(delivery || 0);
  const totalR = Math.round(total || 0);
  const walletKnown = walletBal != null;
  const walletEnough = !walletKnown || walletBal >= totalR;
  const shortForFree = delR > 0 ? Math.max(0, Math.round((freeAbove || 199) - itemsR)) : 0;

  // Load wallet balance / reset when opened or closed.
  useEffect(() => {
    if (!open) { setMode("form"); setOrder(null); setQr("loading"); setPaying(false); setPayErr(""); return; }
    let alive = true;
    setWalletBal(null);
    walletBalance().then((b) => { if (alive) setWalletBal(Number(b) || 0); }).catch(() => { if (alive) setWalletBal(0); });
    return () => { alive = false; };
  }, [open]);

  // If wallet can't cover it, move to online automatically.
  useEffect(() => {
    if (walletKnown && !walletEnough && pay === "wallet" && RAZORPAY_ENABLED) setPay("razorpay");
  }, [walletKnown, walletEnough, pay]);

  // Online: fetch our branded QR + warm the SDK.
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
      } catch (e) { if (alive) { setPayErr(e.message || "Couldn't start the payment."); setQr("error"); } }
    })();
    return () => { alive = false; };
  }, [mode, order]);

  // Poll until the add-on payment confirms → it becomes Scheduled for the delivery.
  useEffect(() => {
    if (mode !== "pay" || !order) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const st = await fetchOrderState(order.dbId);
        if (alive && st?.payment_status === "paid") {
          clearInterval(iv);
          toast(`Added to your ${dayLabel} delivery 🛵`);
          onAdded && onAdded();
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [mode, order]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !upcoming) return null;

  async function confirm() {
    if (busy) return;
    if (!items || items.length === 0) { toast(tr("Your cart is empty.")); return; }
    setBusy(true);
    try {
      const o = await addToDelivery(items, pay);
      if (pay === "wallet") {
        toast(`Added to your ${dayLabel} delivery 🛵`);
        onAdded && onAdded();
      } else {
        setOrder(o);
        setMode("pay");
      }
    } catch (e) {
      toast(e.message || tr("Couldn't add to your delivery."));
    } finally {
      setBusy(false);
    }
  }

  async function payOnThisPhone() {
    if (!order || paying) return;
    setPayErr(""); setPaying(true);
    try {
      const rp = rzpRef.current || (await createRazorpayOrder(order.dbId));
      rzpRef.current = rp;
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: `Add to ${dayLabel} delivery`,
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
    } catch (e) { setPayErr(e.message || "Couldn't open the payment."); setPaying(false); }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>{mode === "pay" ? "Pay for your add-on" : `Add to your ${dayLabel} delivery 🥛`}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {mode === "pay" ? (
          <div className="sub-body">
            <UpiPayScreen
              amount={totalR}
              loading={qr === "loading"}
              qrSrc={qr && qr.url ? qr.url : null}
              upiIntent={upiIntent}
              onRazorpay={payOnThisPhone}
              error={qr === "error" ? payErr : payErr}
              note={`Once paid, these items ride along with your ${dayLabel} delivery.`}
            />
            <button className="ghost-btn full" onClick={onClose} style={{ marginTop: 10 }}>{tr("Cancel")}</button>
          </div>
        ) : (
          <>
            <div className="sub-body">
              <p className="atd-intro">These items will arrive <strong>together with your {dayLabel} delivery</strong> — no separate trip.</p>

              <div className="sub-items">
                {summary.map((s, i) => (
                  <span key={i} className="sub-item-chip">{s.name} × {s.qty}</span>
                ))}
              </div>

              <div className="sub-field-lbl">Pay by</div>
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
                  Wallet has ₹{Math.round(walletBal)} — not enough.{" "}
                  {RAZORPAY_ENABLED ? "Paying online instead." : "Add money to your wallet."}
                </p>
              )}

              <div className="sub-total">
                <div className="sub-total-line"><span>Items</span><span>₹{itemsR}</span></div>
                <div className="sub-total-line"><span>Delivery</span><span>{delR === 0 ? "FREE" : `₹${delR}`}</span></div>
                <div className="sub-total-line"><span>{tr("Handling")}</span><span>₹0 · covered</span></div>
                <div className="sub-total-row"><span>{tr("To pay")}</span><strong>₹{totalR}</strong></div>
                {shortForFree > 0 && (
                  <div className="sub-total-note">Add ₹{shortForFree} more of regular items to qualify for free delivery.</div>
                )}
              </div>
            </div>

            <div className="sub-foot">
              <button
                className="sub-start"
                disabled={busy || (walletKnown && !walletEnough && !RAZORPAY_ENABLED)}
                onClick={confirm}
              >
                {busy ? "Adding…" : `Pay ₹${totalR} & add`}
              </button>
              <p className="sub-cancel-hint">Prepaid — no cash on delivery.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
