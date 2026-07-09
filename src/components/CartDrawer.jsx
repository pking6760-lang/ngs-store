import { useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useProducts } from "../lib/hooks.js";
import { saveOrder } from "../lib/store.js";

const DELIVERY_FEE = 25;
const FREE_DELIVERY_ABOVE = 199;
const HANDLING_FEE = 5;

export default function CartDrawer({ open, onClose }) {
  const { items, add, remove, deleteItem, clear } = useCart();
  const products = useProducts();
  const [placed, setPlaced] = useState(null); // holds order summary once placed

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
  const deliveryFee = itemTotal >= FREE_DELIVERY_ABOVE || itemTotal === 0 ? 0 : DELIVERY_FEE;
  const handling = itemTotal === 0 ? 0 : HANDLING_FEE;
  const grandTotal = itemTotal + deliveryFee + handling;

  function placeOrder() {
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const order = {
      id: "NGS" + Math.floor(1000 + Math.random() * 9000),
      createdAt: new Date().toISOString(),
      customer: "You",
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
    saveOrder(order); // shows up on the admin site
    setPlaced({ total: grandTotal, count, eta: 12 });
    clear();
  }

  function handleClose() {
    setPlaced(null);
    onClose();
  }

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "show" : ""}`}
        onClick={handleClose}
      />
      <aside className={`cart-drawer ${open ? "open" : ""}`}>
        <div className="drawer-head">
          <h2>{placed ? "Order placed" : "My Cart"}</h2>
          <button className="drawer-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {placed ? (
          <div className="order-success">
            <div className="success-badge">✅</div>
            <h3>Order confirmed!</h3>
            <p>
              {placed.count} item{placed.count > 1 ? "s" : ""} • ₹{placed.total}
            </p>
            <p className="success-eta">
              Arriving in <strong>{placed.eta} minutes</strong> 🛵
            </p>
            <button className="checkout-btn" onClick={handleClose}>
              Continue shopping
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
                <div className="savings-pill">You save ₹{savings} on this order 🎉</div>
              )}
              {deliveryFee > 0 && (
                <div className="free-hint">
                  Add ₹{FREE_DELIVERY_ABOVE - itemTotal} more for FREE delivery
                </div>
              )}
            </div>

            <button className="checkout-btn place" onClick={placeOrder}>
              Place order • ₹{grandTotal}
            </button>
          </>
        )}
      </aside>
    </>
  );
}
