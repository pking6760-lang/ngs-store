import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSubscriptionOrder, createRazorpayOrder, verifyRazorpayPayment, walletBalance,
  createOrderQr, fetchOrderState, discardPendingSubscription, createUpiMandate,
} from "../lib/api.js";
import { loadRazorpay, RAZORPAY_ENABLED, cleanUpiQrFromImage, decodeUpiFromQr } from "../lib/payments.js";
import UpiPayScreen from "./UpiPayScreen.jsx";
import { useSettings } from "../lib/hooks.js";
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
  const [waitMandate, setWaitMandate] = useState(false); // approving a UPI mandate
  const rzpRef = useRef(null);
  const settings = useSettings();
  // Real UPI Autopay shows only when Razorpay is on AND either the master flag is
  // set (launched) OR the signed-in phone is the owner's test phone (so the live
  // rupee test can run before launch, without exposing it to real customers).
  const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const isUpiTester =
    !!settings?.upiAutopayTestPhone && last10(user?.phone) === last10(settings.upiAutopayTestPhone);
  const upiAutopayOn = RAZORPAY_ENABLED && (settings?.upiAutopayEnabled === true || isUpiTester);

  const perItems = Math.round(dailyTotal || 0);
  const fee = Math.round(deliveryFee || 0);
  const perDay = perItems + fee;
  const total = perDay * days;
  const autopay = pay === "wallet_daily";       // wallet pay-as-you-go
  const upiAutopay = pay === "upi_autopay";     // real bank e-mandate
  // Wallet auto-pay needs one day's cost; prepay needs the whole plan; UPI
  // Autopay needs no wallet at all (the bank funds it).
  const needAmount = autopay ? perDay : total;
  const walletKnown = walletBal != null;
  const walletEnough = upiAutopay || !walletKnown || walletBal >= needAmount;

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

  // UPI Autopay: once the customer approves the mandate, the webhook flips the
  // umbrella order to paid. Poll for it, then close with success.
  useEffect(() => {
    if (!waitMandate || !order) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const st = await fetchOrderState(order.dbId);
        if (alive && st?.payment_status === "paid") {
          clearInterval(iv);
          setWaitMandate(false);
          toast("UPI Autopay set up 🥛 First delivery tomorrow!");
          onCreated && onCreated();
          onClose();
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [waitMandate, order]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function start() {
    if (busy) return;
    if (!items || items.length === 0) { toast(tr("Your cart is empty.")); return; }
    if (days < 1) { toast(tr("Choose how many days.")); return; }
    if (upiAutopay) { startUpiAutopay(); return; }
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

  // Real UPI Autopay: create the mandate, then open Razorpay's approval screen so
  // the customer authorises the daily bank auto-debit once in their UPI app. The
  // webhook confirms it server-side; the poll effect below closes the sheet.
  async function startUpiAutopay() {
    if (busy) return;
    setBusy(true); setPayErr("");
    try {
      const o = await createSubscriptionOrder({ items, days, hour, address, location, pay: "upi_autopay" });
      const m = await createUpiMandate(o.dbId);
      setOrder(o);
      // Razorpay's web Checkout can't complete UPI inside an Android WebView (it
      // can't launch the UPI app → "No appropriate payment method found"), so we
      // open the mandate approval in the SYSTEM browser, which can. The webhook
      // confirms the mandate server-side; the poll effect below flips the sheet to
      // success once the order turns paid. Same pattern the app uses for APKs.
      setWaitMandate(true);
      setBusy(false);
      if (m?.mandateUrl) window.open(m.mandateUrl, "_system");
      else toast("Couldn't open the autopay screen. Please try again.");
    } catch (e) {
      setBusy(false); setWaitMandate(false);
      toast(e.message || "Couldn't start UPI Autopay.");
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
          <h3 className="sub-head-title">
            <span className="sub-head-ic" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v4h-4" /></svg>
            </span>
            {mode === "pay" ? "Pay for your plan" : "Subscribe"}
          </h3>
          <button className="drawer-close" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        {waitMandate ? (
          <div className="sub-body sub-mandate-wait">
            <div className="mandate-spin" aria-hidden="true" />
            <h4>Approve UPI Autopay in your UPI app</h4>
            <p>
              We opened the secure approval page in your browser. Approve the
              autopay there, then come back here — this will confirm automatically.
            </p>
            <div className="mandate-steps">
              <span>1. Approve the autopay mandate in your UPI app</span>
              <span>2. Return to NGS — no need to do anything else</span>
            </div>
            <button className="ghost-btn full" onClick={() => { setWaitMandate(false); }} style={{ marginTop: 14 }}>
              {tr("Cancel")}
            </button>
            <p className="mandate-note">A ₹1 bank verification is charged and credited straight back to your NGS wallet. Your bank then auto-pays one day's amount the evening before each delivery — nothing more.</p>
          </div>
        ) : mode === "pay" ? (
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
                {upiAutopayOn && (
                  <button
                    type="button"
                    className={`sub-paymode ${upiAutopay ? "on" : ""}`}
                    onClick={() => setPay("upi_autopay")}
                  >
                    <span className="sub-paymode-top">
                      <b>{tr("UPI Autopay")}</b>
                      <span className="sub-paymode-tag">{tr("Recommended")}</span>
                    </span>
                    <span className="sub-paymode-sub">Approve once in your UPI app — your bank auto-pays ₹{perDay}/day. No wallet needed.</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`sub-paymode ${autopay ? "on" : ""}`}
                  onClick={() => setPay("wallet_daily")}
                >
                  <span className="sub-paymode-top">
                    <b>{tr("Wallet Auto-pay")}</b>
                  </span>
                  <span className="sub-paymode-sub">₹{perDay}/day from your NGS Wallet — pay only for what's delivered.</span>
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
              {walletKnown && !upiAutopay && (
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
                  <strong>{(autopay || upiAutopay) ? `₹${perDay}/day` : `₹${total}`}</strong>
                </div>
                <div className="sub-total-note">
                  {upiAutopay
                    ? `Nothing charged now — approve once, then your bank auto-pays ₹${perDay} the day before each delivery. First delivery tomorrow.`
                    : autopay
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
                {busy ? (upiAutopay ? "Opening…" : "Starting…")
                  : upiAutopay ? "Set up UPI Autopay"
                  : autopay ? "Start auto-pay"
                  : pay === "wallet" ? `Pay ₹${total} & start` : `Continue · ₹${total}`}
              </button>
              <p className="sub-cancel-hint">
                {upiAutopay
                  ? "Cancel anytime from Account → Subscriptions — the mandate is revoked and nothing more is debited."
                  : autopay
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
