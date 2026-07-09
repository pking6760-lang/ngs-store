import { useEffect, useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useProducts } from "../lib/hooks.js";
import { saveOrder } from "../lib/store.js";
import { getCurrentLocation, googleMapsLink } from "../lib/location.js";
import { buildUpiLink, qrDataUri, SHOP_UPI_ID } from "../lib/payments.js";

const DELIVERY_FEE = 25;
const FREE_DELIVERY_ABOVE = 199;
const HANDLING_FEE = 5;

export default function CartDrawer({ open, onClose, onRequireLogin }) {
  const { items, add, remove, deleteItem, clear } = useCart();
  const { user, isLoggedIn, updateProfile } = useAuth();
  const products = useProducts();

  // step: "cart" | "checkout" | "pay" | "done"
  const [step, setStep] = useState("cart");
  const [placed, setPlaced] = useState(null);

  // checkout details
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState(null); // { lat, lng, accuracy }
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [payment, setPayment] = useState("upi"); // "upi" | "cod"

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
  const deliveryFee =
    itemTotal >= FREE_DELIVERY_ABOVE || itemTotal === 0 ? 0 : DELIVERY_FEE;
  const handling = itemTotal === 0 ? 0 : HANDLING_FEE;
  const grandTotal = itemTotal + deliveryFee + handling;

  // Prefill the address from the saved profile when the checkout opens.
  useEffect(() => {
    if (step === "checkout" && user?.address && !address) {
      setAddress(user.address);
    }
  }, [step, user, address]);

  function goToCheckout() {
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
      const loc = await getCurrentLocation();
      setLocation(loc);
    } catch (err) {
      setLocError(err.message);
    } finally {
      setLocating(false);
    }
  }

  function proceedFromCheckout() {
    if (!address.trim()) {
      setLocError("Please enter a delivery address.");
      return;
    }
    // Remember the address on the profile for next time.
    if (address.trim() && address.trim() !== user?.address) {
      updateProfile({ address: address.trim() });
    }
    if (payment === "upi") {
      setStep("pay");
    } else {
      placeOrder();
    }
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
      location, // { lat, lng } or null — powers admin location tracking
      payment, // "upi" | "cod"
      status: "Placed",
      items: lines.map(({ product, qty }) => ({
        id: product.id,
        name: product.name,
        icon: product.icon,
        qty,
        price: product.price,
      })),
      itemTotal,
      deliveryFee,
      handling,
      total: grandTotal,
      count,
    };
    saveOrder(order); // shows up on the admin app
    setPlaced({ total: grandTotal, count, eta: 12, payment });
    clear();
    setStep("done");
  }

  function handleClose() {
    setStep("cart");
    setPlaced(null);
    setLocError("");
    onClose();
  }

  const upiLink = buildUpiLink({
    amount: grandTotal,
    note: `NGS Store order`,
  });

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "show" : ""}`}
        onClick={handleClose}
      />
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

        {/* ── DONE ─────────────────────────────────────────── */}
        {step === "done" && placed ? (
          <div className="order-success">
            <div className="success-badge">✅</div>
            <h3>Order confirmed!</h3>
            <p>
              {placed.count} item{placed.count > 1 ? "s" : ""} • ₹{placed.total}
            </p>
            <p className="success-pay">
              {placed.payment === "upi"
                ? "Paid via UPI"
                : "Cash on delivery"}
            </p>
            <p className="success-eta">
              Arriving in <strong>{placed.eta} minutes</strong> 🛵
            </p>
            <button className="checkout-btn" onClick={handleClose}>
              Continue shopping
            </button>
          </div>
        ) : /* ── PAY (UPI) ──────────────────────────────────── */
        step === "pay" ? (
          <div className="pay-step">
            <div className="pay-amount">
              Amount to pay <strong>₹{grandTotal}</strong>
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
        ) : /* ── CHECKOUT ───────────────────────────────────── */
        step === "checkout" ? (
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

              <button
                className="location-btn"
                onClick={useMyLocation}
                disabled={locating}
              >
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
                <input
                  type="radio"
                  name="pay"
                  checked={payment === "upi"}
                  onChange={() => setPayment("upi")}
                />
                <span className="pay-option-icon">🟣</span>
                <span className="pay-option-text">
                  <strong>UPI</strong>
                  <small>GPay, PhonePe, Paytm, BHIM</small>
                </span>
              </label>
              <label className={`pay-option ${payment === "cod" ? "sel" : ""}`}>
                <input
                  type="radio"
                  name="pay"
                  checked={payment === "cod"}
                  onChange={() => setPayment("cod")}
                />
                <span className="pay-option-icon">💵</span>
                <span className="pay-option-text">
                  <strong>Cash on delivery</strong>
                  <small>Pay when your order arrives</small>
                </span>
              </label>
            </div>

            <div className="bill compact">
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
        ) : /* ── CART ───────────────────────────────────────── */
        lines.length === 0 ? (
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
            <div className="delivery-note">
              ⚡ Delivery in <strong>12 minutes</strong>
            </div>

            <div className="cart-lines">
              {lines.map(({ product, qty }) => (
                <div className="cart-line" key={product.id}>
                  <div className="cart-line-icon">{product.icon}</div>
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

            <div className="bill">
              <h4>Bill details</h4>
              <div className="bill-row">
                <span>Item total</span>
                <span>₹{itemTotal}</span>
              </div>
              <div className="bill-row">
                <span>Delivery fee</span>
                <span>
                  {deliveryFee === 0 ? (
                    <span className="free">FREE</span>
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
                <div className="savings-pill">
                  You save ₹{savings} on this order 🎉
                </div>
              )}
              {deliveryFee > 0 && (
                <div className="free-hint">
                  Add ₹{FREE_DELIVERY_ABOVE - itemTotal} more for FREE delivery
                </div>
              )}
            </div>

            <button className="checkout-btn place" onClick={goToCheckout}>
              Proceed to checkout • ₹{grandTotal}
            </button>
          </>
        )}
      </aside>
    </>
  );
}
