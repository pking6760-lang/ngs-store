import { useEffect, useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useProducts, useSettings, useCategories, useCoupons } from "../lib/hooks.js";
import { saveOrder, applyCoupon } from "../lib/store.js";
import { getCurrentLocation, googleMapsLink } from "../lib/location.js";
import { buildUpiLink, qrDataUri, SHOP_UPI_ID } from "../lib/payments.js";
import ProductThumb from "./ProductThumb.jsx";
import {
  pointsForSpend,
  redeemableRupees,
} from "../lib/rewards.js";

const DELIVERY_FEE = 25;
const FREE_DELIVERY_ABOVE = 199;
const HANDLING_FEE = 5;

export default function CartDrawer({ open, onClose, onRequireLogin }) {
  const { items, add, remove, deleteItem, clear } = useCart();
  const { user, isLoggedIn, updateProfile, applyRewards } = useAuth();
  const products = useProducts();
  const settings = useSettings();
  const categories = useCategories();
  const allCoupons = useCoupons();

  const [step, setStep] = useState("cart"); // cart | checkout | pay | done
  const [placed, setPlaced] = useState(null);
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [payment, setPayment] = useState("upi"); // upi | cod
  const [usePoints, setUsePoints] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [showCoupons, setShowCoupons] = useState(false);

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
  const discount = usePoints && isLoggedIn ? maxRedeemRupees : 0;
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
  const couponResult = appliedCode ? applyCoupon(appliedCode, couponCtx) : null;
  const couponDiscount = couponResult?.ok
    ? Math.min(couponResult.discount, itemTotal - discount)
    : 0;
  const couponInvalid = appliedCode && couponResult && !couponResult.ok;

  const netItems = Math.max(0, itemTotal - discount - couponDiscount);

  // ── Delivery fee (with membership + surge rules) ───────
  let deliveryFee =
    itemTotal >= FREE_DELIVERY_ABOVE || itemTotal === 0 ? 0 : DELIVERY_FEE;
  let freeReason = deliveryFee === 0 && itemTotal > 0 ? "order" : null;
  if (isMember && !isSurge && itemTotal > 0) {
    deliveryFee = 0;
    freeReason = "member";
  }

  const handling = itemTotal === 0 ? 0 : HANDLING_FEE;
  const grandTotal = netItems + deliveryFee + handling;
  const pointsEarned = pointsForSpend(netItems, rewardsCfg);

  useEffect(() => {
    if (step === "checkout" && user?.address && !address) {
      setAddress(user.address);
    }
  }, [step, user, address]);

  function goToCheckout() {
    if (!settings.storeOpen) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setStep("checkout");
  }

  async function useMyLocation() {
    setLocating(true);
    setLocError("");
    try {
      setLocation(await getCurrentLocation());
    } catch (err) {
      setLocError(err.message);
    } finally {
      setLocating(false);
    }
  }

  function applyCouponCode(code) {
    const res = applyCoupon(code ?? couponInput, couponCtx);
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

  function proceedFromCheckout() {
    if (!address.trim()) {
      setLocError("Please enter a delivery address.");
      return;
    }
    if (address.trim() !== user?.address) {
      updateProfile({ address: address.trim() });
    }
    if (payment === "upi") setStep("pay");
    else placeOrder();
  }

  function placeOrder() {
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const order = {
      id: "NGS" + Math.floor(1000 + Math.random() * 9000),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      customer: user?.name || "You",
      userPhone: user?.phone || "",
      address: address.trim(),
      location,
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
      total: grandTotal,
      count,
    };
    saveOrder(order);
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
              {placed.payment === "upi" ? "Paid via UPI" : "Cash on delivery"}
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
            <button className="checkout-btn place" onClick={placeOrder}>
              I've paid • Place order
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
              <textarea
                className="checkout-address"
                rows={3}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House / flat no, street, area, city, PIN"
              />
              <button className="location-btn" onClick={useMyLocation} disabled={locating}>
                {locating ? "📍 Getting location…" : "📍 Use my current location"}
              </button>
              {location && (
                <div className="location-captured">
                  <span>
                    ✅ Location captured
                    <br />
                    <small>
                      {location.lat}, {location.lng} (±{location.accuracy}m)
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
              {locError && <div className="auth-error">{locError}</div>}
            </div>

            <div className="checkout-section">
              <h4>Payment method</h4>
              <label className={`pay-option ${payment === "upi" ? "sel" : ""}`}>
                <input type="radio" name="pay" checked={payment === "upi"} onChange={() => setPayment("upi")} />
                <span className="pay-option-icon">🟣</span>
                <span className="pay-option-text">
                  <strong>UPI</strong>
                  <small>GPay, PhonePe, Paytm, BHIM</small>
                </span>
              </label>
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
              <div className="bill-row total">
                <span>To pay</span>
                <span>₹{grandTotal}</span>
              </div>
            </div>

            <button className="checkout-btn place" onClick={proceedFromCheckout}>
              {payment === "upi"
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

            {isLoggedIn && availablePoints > 0 && maxRedeemRupees > 0 && (
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
                        const ev = applyCoupon(c.code, couponCtx);
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
    </>
  );
}
