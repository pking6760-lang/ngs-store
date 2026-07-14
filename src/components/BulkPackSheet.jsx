import { createPortal } from "react-dom";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../lib/hooks.js";
import { tierUnitPrice } from "../lib/bulk.js";

// Pack selector (Zepto/Blinkit style) — a bottom sheet listing pack sizes for a
// product that has bulk pricing. No product image, just "Pack of N", the price,
// the per-unit rate, and an ADD that drops that quantity into the cart.
export default function BulkPackSheet({ product, onClose }) {
  const { items, setQty } = useCart();
  const { user } = useAuth();
  const settings = useSettings();
  const inCart = items[product.id] || 0;
  const base = Number(product.price) || 0;
  // Compare pack prices against the MRP (the true "original"), like Blinkit/Zepto.
  const mrp = Math.max(Number(product.mrp) || 0, base);
  const tiers = Array.isArray(product.bulkTiers) ? product.bulkTiers : [];
  const stock = typeof product.stock === "number" ? product.stock : Infinity;
  // Pack of 1 (base) plus one option per bulk tier quantity.
  const packs = [1, ...tiers.map((t) => Number(t.q))].filter((q) => q <= stock || q === 1);

  function choose(q) {
    setQty(product.id, Math.min(q, stock));
    onClose();
  }

  return createPortal(
    <div className="bulk-sheet-overlay" onClick={onClose}>
      <div className="bulk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bulk-sheet-head">
          <h3>{product.name}</h3>
          <button className="bulk-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="bulk-grid">
          {packs.map((q) => {
            const unit = tierUnitPrice(product, q, user, settings.rewards);
            const total = unit * q;
            const orig = mrp * q;
            const save = orig - total;
            const selected = inCart === q;
            return (
              <div className={`bulk-card ${selected ? "sel" : ""}`} key={q}>
                <div className="bulk-card-qty">Pack of {q}</div>
                {product.unit && <div className="bulk-card-sub">{q} × {product.unit}</div>}
                <div className="bulk-card-price">
                  ₹{total}
                  {save > 0 && <span className="bulk-card-was">₹{orig}</span>}
                </div>
                <div className="bulk-card-per">
                  ₹{unit} each{save > 0 && <span className="bulk-card-save"> · save ₹{save}</span>}
                </div>
                <button className="bulk-card-add" onClick={() => choose(q)}>
                  {selected ? "✓ In cart" : "ADD"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
