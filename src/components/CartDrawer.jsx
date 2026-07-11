import { useEffect, useRef, useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useProducts, useSettings, useCategories, useCoupons } from "../lib/hooks.js";
import { saveOrder, applyCouponFrom, decrementStock, getShopLocations } from "../lib/store.js";
import * as api from "../lib/api.js";
import { getCurrentLocation, googleMapsLink, distanceKm, reverseGeocode, searchAddress } from "../lib/location.js";
import { buildUpiLink, qrDataUri, SHOP_UPI_ID, RAZORPAY_ENABLED, loadRazorpay } from "../lib/payments.js";
import ProductThumb from "./ProductThumb.jsx";
import MapPicker from "./MapPicker.jsx";
import {
  pointsForSpend,
  redeemableRupees,
} from "../lib/rewards.js";

// Persist the delivery address + phone the customer typed, so a page refresh
// doesn't wipe them (the cart itself is already saved by CartContext).
const DRAFT_KEY = "ngs-checkout-draft-v1";
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); }
  catch { return {}; }
}

export default function CartDrawer({ open, onClose, onRequireLogin }) {
  const { items, add, remove, deleteItem, clear } = useCart();
  const { user, isLoggedIn, updateProfile, applyRewards } = useAuth();
  const products = useProducts();
  const settings = useSettings();
  const categories = useCategories();
  const allCoupons = useCoupons();

  const BACKEND = api.isBackendConfigured;
  const [step, setStep] = useState("cart"); // cart | checkout | pay | done
  const [placed, setPlaced] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [address, setAddress] = useState(() => loadDraft().address || "");
  const [phone, setPhone] = useState(() => loadDraft().phone || "");
  const [location, setLocation] = useState(() => loadDraft().location || null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  // razorpay (verified online) | upi (legacy QR, unverified) | cod. When online
  // payments are enabled we default to them and drop the unverified QR option.
  const [payment, setPayment] = useState(RAZORPAY_ENABLED ? "razorpay" : "upi");
  const [usePoints, setUsePoints] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [showCoupons, setShowCoupons] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const searchTimer = useRef();

  const lines = Object.entries(items)
    .map(([id, qty]) => {
      const product = products.find((p) => p.id === id);
      return product ? { product, qty } : null;
    })
    .filter(Boolean);

  const itemTotal = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
  const savings = lines.reduce(
    (sum, l) => sum + (l.product.mrp - l.product.price) * l.qty,
    0
  );

  // ── Reward redemption ──────────────────────────────────
  const isMember = !!user?.member;
  const isSurge = settings.deliveryMode === "surge";
  const rewardsCfg = settings.rewards;
  const redeemPer = rewardsCfg?.redeemPer || 10;
  const availablePoints = user?.points || 0;
  // You can't redeem more than the item total.
  const maxRedeemRupees = Math.min(
    redeemableRupees(availablePoints, rewardsCfg),
    itemTotal
  );
  // Points redemption at checkout is a demo-only feature for now; on the real
  // backend, points still EARN on every order (server-side), and spending them
  // will be added as a server-checked step.
  const canRedeem = !BACKEND;
  const discount = usePoints && isLoggedIn && canRedeem ? maxRedeemRupees : 0;
  const pointsUsed = discount * redeemPer;

  // Per-category subtotals + a name lookup, so coupons can require a certain
  // product type or a minimum amount.
  const catTotals = {};
  for (const { product, qty } of lines) {
    catTotals[product.category] =
      (catTotals[product.category] || 0) + product.price * qty;
  }
  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  const couponCtx = { itemTotal, catTotals, catName };
  const activeCoupons = allCoupons.filter((c) => c.active);

  // Coupon — re-validated against the current cart each render so it stays
  // correct if items are added/removed.
  const couponResult = appliedCode ? applyCouponFrom(allCoupons, appliedCode, couponCtx) : null;
  const couponDiscount = couponResult?.ok
    ? Math.min(couponResult.discount, itemTotal - discount)
    : 0;
  const couponInvalid = appliedCode && couponResult && !couponResult.ok;

  const netItems = Math.max(0, itemTotal - discount - couponDiscount);

  // ── Delivery fee (admin-controlled, with membership + surge rules) ──
  const DELIVERY_FEE = settings.deliveryFee ?? 25;
  const FREE_DELIVERY_ABOVE = settings.freeDeliveryAbove ?? 199;
  const HANDLING_FEE = settings.handlingFee ?? 5;
  const SURGE_FEE = settings.surgeFee ?? 0;
  let deliveryFee =
    itemTotal >= FREE_DELIVERY_ABOVE || itemTotal === 0 ? 0 : DELIVERY_FEE;
  let freeReason = deliveryFee === 0 && itemTotal > 0 ? "order" : null;
  if (isMember && itemTotal > 0 && deliveryFee > 0) {
    deliveryFee = 0;
    freeReason = "member";
  }

  const handling = itemTotal === 0 ? 0 : HANDLING_FEE;
  // Surge / bad-weather premium — applies to everyone while surge mode is on.
  const surgeFee = isSurge && itemTotal > 0 ? SURGE_FEE : 0;
  const grandTotal = netItems + deliveryFee + handling + surgeFee;
  const pointsEarned = pointsForSpend(netItems, rewardsCfg);

  // ── Delivery area (distance to the nearest shop) ───────
  const maxKm = settings.maxDistanceKm || 0;
  const shops = getShopLocations(settings);
  const areaEnforced = shops.length > 0 && maxKm > 0;
  const dist =
    location && shops.length
      ? Math.round(Math.min(...shops.map((s) => distanceKm(location, s))) * 10) / 10
      : null;
  const outOfArea = areaEnforced && dist != null && dist > maxKm;
  const needsLocation = areaEnforced && !location;

  // Prefill from the saved profile when the field is still empty.
  useEffect(() => {
    if (step !== "checkout") return;
    if (user?.address && !address) setAddress(user.address);
    if (user?.phone && !phone) setPhone(user.phone);
  }, [step, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the address, phone AND captured GPS location across refreshes, so
  // the customer never has to re-enter them or re-share their location.
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ address, phone, location })); }
    catch { /* ignore */ }
  }, [address, phone, location]);

  function goToCheckout() {
    if (!settings.storeOpen) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setStep("checkout");
  }

  // As the customer types their address, look up matching places (debounced).
  function onAddressChange(value) {
    setAddress(value);
    clearTimeout(searchTimer.current);
    if (value.trim().length < 3) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const shop = getShopLocations(settings)[0];
        const res = await searchAddress(value, shop ? { lat: shop.lat, lng: shop.lng } : null);
        setSuggestions(res);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 350);
  }

  // Customer picks a place → fill the address and capture its coordinates.
  function pickSuggestion(s) {
    setAddress(s.label);
    setLocation({ lat: s.lat, lng: s.lng, accuracy: null });
    setSuggestions([]);
    setLocError("");
  }

  async function useMyLocation() {
    setLocating(true);
    setLocError("");
    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
      // Auto-fill the address box with the customer's current street address.
      try {
        const addr = await reverseGeocode(loc.lat, loc.lng);
        if (addr) setAddress(addr);
      } catch { /* keep the captured coords even if the lookup fails */ }
    } catch (err) {
      setLocError(err.message);
    } finally {
      setLocating(false);
    }
  }

  function applyCouponCode(code) {
    const res = applyCouponFrom(allCoupons, code ?? couponInput, couponCtx);
    if (res.ok) {
      setAppliedCode(res.code);
      setCouponInput("");
      setCouponError("");
      setShowCoupons(false);
    } else {
      setCouponError(res.error);
    }
  }

  function removeCoupon() {
    setAppliedCode(null);
    setCouponError("");
  }

  const cleanPhone = phone.replace(/\D/g, "");

  async function proceedFromCheckout() {
    if (!address.trim()) {
      setLocError("Please enter a delivery address.");
      return;
    }
    if (cleanPhone.length !== 10) {
      setLocError("Please enter a valid 10-digit phone number so we can call about your delivery.");
      return;
    }
    // Location is optional — a customer who can't/won't share it can still
    // order using their typed address. The out-of-area block only applies to
    // customers who DID share location and are beyond the delivery radius.
    if (outOfArea) return; // button is disabled, but guard anyway
    setLocError("");
    // Save address + phone to the profile. Await it so the server has the phone
    // when place_order records the order (needed to call the customer).
    if (address.trim() !== user?.address || cleanPhone !== user?.phone) {
      await updateProfile({ address: address.trim(), phone: cleanPhone });
    }
    if (payment === "razorpay") startRazorpay();
    else if (payment === "upi") setStep("pay");
    else placeOrder();
  }

  // Verified online payment (Razorpay). Flow: create a HELD order on the server
  // (real total computed there) → create a matching Razorpay order → open the
  // Razorpay screen → on success the SERVER verifies the signature and only then
  // confirms the order. Nothing is charged or confirmed on the phone's word.
  async function startRazorpay() {
    setPlacing(true);
    setPlaceError("");
    let order;
    try {
      order = await api.placeOrder({
        items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
        coupon: appliedCode || null,
        location: location ? { ...location, distanceKm: dist } : null,
        payment: "razorpay",
        address: address.trim(),
      });
      const rp = await api.createRazorpayOrder(order.dbId);
      const Razorpay = await loadRazorpay();
      const count = lines.reduce((a, l) => a + l.qty, 0);

      let done = false;
      const showSuccess = () => {
        if (done) return;
        done = true;
        setPlaced({
          total: order.total, count, eta: 12, payment: "razorpay",
          pointsEarned: order.pointsEarned, code: order.id,
        });
        clear();
        setUsePoints(false);
        setAppliedCode(null);
        setStep("done");
        setPlacing(false);
      };
      // Fallback: if the in-page callback doesn't fire (async UPI), the webhook
      // still confirms the order server-side — poll for it before giving up.
      const pollPaid = async (tries = 6) => {
        for (let i = 0; i < tries && !done; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const st = await api.fetchOrderState(order.dbId);
            if (st?.payment_status === "paid") { showSuccess(); return true; }
          } catch { /* keep trying */ }
        }
        return false;
      };

      const rzp = new Razorpay({
        key: rp.keyId,
        order_id: rp.orderId,
        amount: rp.amount,
        currency: rp.currency || "INR",
        name: "NGS Nisha General Store",
        description: `Order ${order.id}`,
        prefill: {
          name: user?.name || "",
          email: user?.email || "",
          contact: cleanPhone || user?.phone || "",
        },
        theme: { color: "#0a9155" },
        handler: async (resp) => {
          try {
            await api.verifyRazorpayPayment({
              orderId: order.dbId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            showSuccess();
          } catch {
            // Verify didn't confirm from the browser — the webhook may still.
            const ok = await pollPaid();
            if (!ok) {
              setPlacing(false);
              setPlaceError(
                "We couldn't confirm your payment yet. If money was deducted, your order " +
                  "will appear shortly (or be refunded automatically). Please check 'My orders'."
              );
            }
          }
        },
        modal: {
          ondismiss: async () => {
            // The customer closed the sheet — but an async UPI payment may have
            // gone through. Give the webhook a moment before calling it cancelled.
            const ok = await pollPaid(4);
            if (!ok) {
              setPlacing(false);
              setPlaceError("Payment cancelled — your order was not placed. You can try again.");
            }
          },
        },
      });
      rzp.on("payment.failed", (r) => {
        setPlacing(false);
        setPlaceError(r?.error?.description || "Payment failed. Please try again.");
      });
      rzp.open();
    } catch (e) {
      setPlacing(false);
      setPlaceError(e.message || "Couldn't start the payment. Please try again.");
    }
  }

  // Backend checkout: the SERVER recomputes prices, coupon, delivery, total and
  // points via place_order(). The phone only sends product ids + quantities.
  async function placeOrderBackend() {
    setPlacing(true);
    setPlaceError("");
    try {
      const order = await api.placeOrder({
        items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
        coupon: appliedCode || null,
        location: location ? { ...location, distanceKm: dist } : null,
        payment,
        address: address.trim(),
      });
      setPlaced({
        // place_order returns only the order row (no joined items), so count
        // the cart we just sent rather than order.count (which would be 0).
        total: order.total,
        count: lines.reduce((a, l) => a + l.qty, 0),
        eta: 12, payment,
        pointsEarned: order.pointsEarned, code: order.id,
      });
      clear();
      setUsePoints(false);
      setAppliedCode(null);
      setStep("done");
    } catch (e) {
      setPlaceError(e.message || "Couldn't place the order. Please try again.");
      setStep("checkout");
    } finally {
      setPlacing(false);
    }
  }

  function placeOrder() {
    if (BACKEND) return placeOrderBackend();
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const order = {
      id: "NGS" + Math.floor(1000 + Math.random() * 9000),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      customer: user?.name || "You",
      userPhone: cleanPhone || user?.phone || "",
      address: address.trim(),
      location,
      distanceKm: dist,
      payment,
      member: isMember,
      priority: isMember, // members get first priority
      accepted: false, // waits for admin to accept on the incoming screen
      status: "Placed",
      items: lines.map(({ product, qty }) => ({
        id: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        qty,
        price: product.price,
      })),
      itemTotal,
      discount,
      couponCode: couponDiscount > 0 ? appliedCode : null,
      couponDiscount,
      pointsUsed,
      pointsEarned,
      deliveryFee,
      handling,
      surgeFee,
      total: grandTotal,
      count,
    };
    saveOrder(order);
    decrementStock(order.items); // keep inventory / low-stock alerts in sync
    // Update the customer's points: earn on what they paid, spend what they used.
    applyRewards({ earned: pointsEarned, used: pointsUsed });
    setPlaced({ total: grandTotal, count, eta: 12, payment, pointsEarned });
    clear();
    setUsePoints(false);
    setAppliedCode(null);
    setStep("done");
  }

  function handleClose() {
    setStep("cart");
    setPlaced(null);
    setLocError("");
    onClose();
  }

  const upiLink = buildUpiLink({ amount: grandTotal, note: "NGS Store order" });
  const storeClosed = !settings.storeOpen;

  return (
    <>
      <div className={`drawer-overlay ${open ? "show" : ""}`} onClick={handleClose} />
      <aside className={`cart-drawer ${open ? "open" : ""}`}>
        <div className="drawer-head">
          {step !== "cart" && step !== "done" && (
            <button
              className="back-btn small"
              onClick={() => setStep(step === "pay" ? "checkout" : "cart")}
              aria-label="Back"
            >
              ←
            </button>
          )}
          <h2>
            {step === "done"
              ? "Order placed"
              : step === "pay"
              ? "Pay with UPI"
              : step === "checkout"
              ? "Checkout"
              : "My Cart"}
          </h2>
          <button className="drawer-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {step === "done" && placed ? (
          <div className="order-success">
            <div className="success-badge">✅</div>
            <h3>Order confirmed!</h3>
            <p>
              {placed.count} item{placed.count > 1 ? "s" : ""} • ₹{placed.total}
            </p>
            <p className="success-pay">
              {placed.payment === "razorpay"
                ? "✅ Paid online"
                : placed.payment === "upi"
                ? "Paid via UPI"
                : "Cash on delivery"}
            </p>
            {placed.pointsEarned > 0 && (
              <p className="success-points">
                🎁 You earned <strong>{placed.pointsEarned} points</strong>
              </p>
            )}
            <p className="success-eta">
              Arriving in <strong>{placed.eta} minutes</strong> 🛵
            </p>
            <button className="checkout-btn" onClick={handleClose}>
              Continue shopping
            </button>
          </div>
        ) : step === "pay" ? (
          <div className="pay-step">
            <div className="pay-amount">
              Amount to pay <strong>₹{grandTotal}</strong>
              <span className="pay-fixed">🔒 Fixed amount — pre-filled for you</span>
            </div>
            <div className="upi-qr-wrap">
              <img className="upi-qr" src={qrDataUri(upiLink)} alt="UPI QR code" />
              <p className="upi-hint">
                Scan with any UPI app (GPay, PhonePe, Paytm, BHIM)
              </p>
            </div>
            <a className="upi-app-btn" href={upiLink}>
              📱 Open UPI app to pay ₹{grandTotal}
            </a>
            <div className="upi-id-row">
              <span>Or pay to UPI ID</span>
              <code>{SHOP_UPI_ID}</code>
            </div>
            {placeError && <div className="auth-error">{placeError}</div>}
            <button className="checkout-btn place" onClick={placeOrder} disabled={placing}>
              {placing ? "Placing…" : "I've paid • Place order"}
            </button>
            <p className="upi-note">
              Demo: payment isn't actually verified. On a real setup the order
              confirms automatically once UPI payment succeeds.
            </p>
          </div>
        ) : step === "checkout" ? (
          <div className="checkout-step">
            <div className="checkout-section">
              <h4>Delivery address</h4>
              <div className="address-autocomplete">
                <textarea
                  className="checkout-address"
                  rows={3}
                  value={address}
                  onChange={(e) => onAddressChange(e.target.value)}
                  placeholder="Start typing your area / street, then pick it below"
                />
                {(searching || suggestions.length > 0) && (
                  <div className="address-suggest">
                    {searching && suggestions.length === 0 && (
                      <div className="address-suggest-loading">Searching the map…</div>
                    )}
                    {suggestions.map((s, i) => (
                      <button
                        type="button"
                        className="address-suggest-item"
                        key={i}
                        onClick={() => pickSuggestion(s)}
                      >
                        📍 {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="address-hint">
                Tip: pick your area from the list so we get your exact location,
                then add your house / flat number.
              </p>
              <div className="checkout-phone">
                <span className="checkout-phone-cc">🇮🇳 +91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="Phone number (for delivery calls)"
                />
              </div>
              <div className="location-actions">
                <button className="location-btn" onClick={() => setShowMap(true)}>
                  🗺️ Pin exact location on map
                </button>
                <button className="location-btn subtle" onClick={useMyLocation} disabled={locating}>
                  {locating ? "📍 Getting location…" : "📍 Use current GPS"}
                </button>
              </div>
              {needsLocation && (
                <div className="area-hint">
                  📍 Tip: pin your exact spot on the map so delivery reaches the
                  right door. You can still order without it.
                </div>
              )}
              {location && (
                <div className={`location-captured ${outOfArea ? "bad" : ""}`}>
                  <span>
                    ✅ Location captured
                    <br />
                    <small>
                      {location.lat}, {location.lng}
                      {dist != null ? ` · ${dist} km from shop` : ""}
                    </small>
                  </span>
                  <a
                    href={googleMapsLink(location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="view-map-link"
                  >
                    View on Google Maps →
                  </a>
                </div>
              )}
              {outOfArea && (
                <div className="area-blocked">
                  🚧 Sorry, you're about <strong>{dist} km</strong> away — we
                  currently deliver within <strong>{maxKm} km</strong>.
                  <br />
                  We're coming to your area soon! 💚
                </div>
              )}
              {dist != null && !outOfArea && (
                <div className="area-ok">✅ Great news — we deliver to your area!</div>
              )}
              {locError && <div className="auth-error">{locError}</div>}
            </div>

            <div className="checkout-section">
              <h4>Payment method</h4>
              {RAZORPAY_ENABLED ? (
                <label className={`pay-option ${payment === "razorpay" ? "sel" : ""}`}>
                  <input type="radio" name="pay" checked={payment === "razorpay"} onChange={() => setPayment("razorpay")} />
                  <span className="pay-option-icon">💳</span>
                  <span className="pay-option-text">
                    <strong>Pay online</strong>
                    <small>UPI, Cards, Wallets · secure &amp; instant</small>
                  </span>
                </label>
              ) : (
                <label className={`pay-option ${payment === "upi" ? "sel" : ""}`}>
                  <input type="radio" name="pay" checked={payment === "upi"} onChange={() => setPayment("upi")} />
                  <span className="pay-option-icon">🟣</span>
                  <span className="pay-option-text">
                    <strong>UPI</strong>
                    <small>GPay, PhonePe, Paytm, BHIM</small>
                  </span>
                </label>
              )}
              <label className={`pay-option ${payment === "cod" ? "sel" : ""}`}>
                <input type="radio" name="pay" checked={payment === "cod"} onChange={() => setPayment("cod")} />
                <span className="pay-option-icon">💵</span>
                <span className="pay-option-text">
                  <strong>Cash on delivery</strong>
                  <small>Pay when your order arrives</small>
                </span>
              </label>
            </div>

            <div className="bill compact">
              {discount > 0 && (
                <div className="bill-row">
                  <span>Points discount</span>
                  <span className="free">−₹{discount}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="bill-row">
                  <span>Coupon ({appliedCode})</span>
                  <span className="free">−₹{couponDiscount}</span>
                </div>
              )}
              <div className="bill-row">
                <span>Delivery fee</span>
                <span>
                  {deliveryFee === 0 ? (
                    <span className="free">
                      FREE{freeReason === "member" ? " · Prime" : ""}
                    </span>
                  ) : (
                    `₹${deliveryFee}`
                  )}
                </span>
              </div>
              {surgeFee > 0 && (
                <div className="bill-row">
                  <span>🌧️ Surge charge</span>
                  <span>₹{surgeFee}</span>
                </div>
              )}
              <div className="bill-row total">
                <span>To pay</span>
                <span>₹{grandTotal}</span>
              </div>
            </div>

            {placeError && <div className="auth-error">{placeError}</div>}
            <button
              className="checkout-btn place"
              onClick={proceedFromCheckout}
              disabled={outOfArea || placing}
            >
              {placing
                ? "Placing…"
                : outOfArea
                ? "Outside delivery area"
                : payment === "razorpay"
                ? `Pay ₹${grandTotal} securely`
                : payment === "upi"
                ? `Pay ₹${grandTotal} with UPI`
                : `Place order • ₹${grandTotal}`}
            </button>
          </div>
        ) : lines.length === 0 ? (
          <div className="cart-empty">
            <div className="empty-emoji">🛒</div>
            <p>Your cart is empty</p>
            <span>Add items to get started</span>
            <button className="checkout-btn" onClick={handleClose}>
              Browse products
            </button>
          </div>
        ) : (
          <>
            {storeClosed ? (
              <div className="store-closed-note">
                🔴 The store is currently <strong>closed</strong>. You can build
                your cart, but ordering resumes when we reopen.
              </div>
            ) : (
              <div className="delivery-note">
                ⚡ Delivery in <strong>12 minutes</strong>
                {isSurge && (
                  <span className="surge-tag"> · 🌧️ Surge charges apply</span>
                )}
              </div>
            )}

            <div className="cart-lines">
              {lines.map(({ product, qty }) => (
                <div className="cart-line" key={product.id}>
                  <div className="cart-line-icon">
                    <ProductThumb
                      image={product.image}
                      name={product.name}
                      category={product.category}
                      size={44}
                    />
                  </div>
                  <div className="cart-line-info">
                    <div className="cart-line-name">{product.name}</div>
                    <div className="cart-line-unit">{product.unit}</div>
                  </div>
                  <div className="cart-line-right">
                    <div className="qty-stepper small">
                      <button onClick={() => remove(product.id)}>−</button>
                      <span>{qty}</span>
                      <button onClick={() => add(product.id)}>+</button>
                    </div>
                    <div className="cart-line-price">₹{product.price * qty}</div>
                    <button
                      className="line-delete"
                      onClick={() => deleteItem(product.id)}
                      aria-label="Remove item"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {canRedeem && isLoggedIn && availablePoints > 0 && maxRedeemRupees > 0 && (
              <label className="use-points">
                <input
                  type="checkbox"
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <span>
                  🎁 Use {maxRedeemRupees * redeemPer} points for{" "}
                  <strong>₹{maxRedeemRupees} off</strong>
                  <small>You have {availablePoints} points</small>
                </span>
              </label>
            )}

            {/* Coupon */}
            <div className="coupon-box">
              {appliedCode && couponDiscount > 0 ? (
                <div className="coupon-applied">
                  <span>
                    🎟️ <strong>{appliedCode}</strong> applied — ₹{couponDiscount} off
                  </span>
                  <button className="coupon-remove" onClick={removeCoupon}>
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="coupon-input-row">
                    <input
                      className="coupon-input"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value.toUpperCase());
                        setCouponError("");
                      }}
                      placeholder="Coupon code"
                    />
                    <button
                      className="coupon-apply"
                      onClick={() => applyCouponCode()}
                    >
                      Apply
                    </button>
                  </div>
                  {(couponError || couponInvalid) && (
                    <div className="coupon-error">
                      {couponError || couponResult.error}
                    </div>
                  )}

                  {activeCoupons.length > 0 && (
                    <button
                      className="coupon-browse-toggle"
                      onClick={() => setShowCoupons((s) => !s)}
                    >
                      🎟️ {showCoupons ? "Hide coupons" : "View available coupons"}
                    </button>
                  )}

                  {showCoupons && (
                    <div className="coupon-list">
                      {activeCoupons.map((c) => {
                        const ev = applyCouponFrom(allCoupons, c.code, couponCtx);
                        const off =
                          c.type === "percent"
                            ? `${c.value}% OFF`
                            : `₹${c.value} OFF`;
                        const cond = [
                          c.category ? `on ${catName(c.category)}` : null,
                          c.minOrder > 0 ? `min ₹${c.minOrder}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <div className="coupon-card" key={c.code}>
                            <div className="coupon-card-left">
                              <div className="coupon-card-code">
                                🎟️ {c.code}
                                <span className="coupon-card-off">{off}</span>
                              </div>
                              {cond && (
                                <div className="coupon-card-cond">{cond}</div>
                              )}
                              {!ev.ok && (
                                <div className="coupon-card-reason">{ev.error}</div>
                              )}
                            </div>
                            <button
                              className="coupon-card-apply"
                              disabled={!ev.ok}
                              onClick={() => applyCouponCode(c.code)}
                            >
                              {ev.ok ? "Apply" : "—"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bill">
              <h4>Bill details</h4>
              <div className="bill-row">
                <span>Item total</span>
                <span>₹{itemTotal}</span>
              </div>
              {discount > 0 && (
                <div className="bill-row">
                  <span>Points discount</span>
                  <span className="free">−₹{discount}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="bill-row">
                  <span>Coupon ({appliedCode})</span>
                  <span className="free">−₹{couponDiscount}</span>
                </div>
              )}
              <div className="bill-row">
                <span>Delivery fee</span>
                <span>
                  {deliveryFee === 0 ? (
                    <span className="free">
                      FREE{freeReason === "member" ? " · Prime" : ""}
                    </span>
                  ) : (
                    `₹${deliveryFee}`
                  )}
                </span>
              </div>
              <div className="bill-row">
                <span>Handling charge</span>
                <span>₹{handling}</span>
              </div>
              {surgeFee > 0 && (
                <div className="bill-row">
                  <span>🌧️ Surge charge <small>(bad weather / peak)</small></span>
                  <span>₹{surgeFee}</span>
                </div>
              )}
              <div className="bill-row total">
                <span>To pay</span>
                <span>₹{grandTotal}</span>
              </div>
              {savings > 0 && (
                <div className="savings-pill">You save ₹{savings} on this order 🎉</div>
              )}
              {!isMember && deliveryFee > 0 && (
                <div className="free-hint">
                  Add ₹{FREE_DELIVERY_ABOVE - itemTotal} more for FREE delivery
                </div>
              )}
              {itemTotal > 0 && (
                <div className="earn-hint">
                  You'll earn <strong>{pointsEarned} points</strong> on this order
                </div>
              )}
            </div>

            <button
              className="checkout-btn place"
              onClick={goToCheckout}
              disabled={storeClosed}
            >
              {storeClosed
                ? "Store closed"
                : `Proceed to checkout • ₹${grandTotal}`}
            </button>
          </>
        )}
      </aside>
      <MapPicker
        open={showMap}
        initial={location || getShopLocations(settings)[0] || null}
        onClose={() => setShowMap(false)}
        onConfirm={(lat, lng, addr) => {
          setLocation({ lat, lng, accuracy: null });
          if (addr) setAddress(addr);
          setSuggestions([]);
          setLocError("");
          setShowMap(false);
        }}
      />
    </>
  );
}
