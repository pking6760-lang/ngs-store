import { useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../lib/hooks.js";
import ProductThumb from "./ProductThumb.jsx";
import { firstBulkTier, tierUnitPrice } from "../lib/bulk.js";
import BulkPackSheet from "./BulkPackSheet.jsx";
import { useStockAlerts } from "../lib/stockAlerts.js";

// Show scarcity urgency when stock is running low.
const LOW_STOCK = 5;

// ─── Product card ──────────────────────────────────────────────────────────
// One shared anatomy so every tile is the same height in a row:
//   [ image + overlaid badges + floating ADD ]  →  [ name ]  →  [ price ]
// The action (ADD / qty stepper) floats on the image's bottom-right, so the
// price row underneath is always clean and the buttons line up across the rail.
// Discounts live as a flag on the image and savings fold into the price — there
// is no separate "deal line", which is what used to leave plain cards hollow.
export default function ProductCard({ product, badge }) {
  const { items, add, remove } = useCart();
  const { user } = useAuth();
  const settings = useSettings();
  const alerts = useStockAlerts();
  const alerted = alerts.has(product.id);
  const qty = items[product.id] || 0;
  // The price this shopper actually pays (their member tier's price).
  const price = tierUnitPrice(product, 1, user, settings.rewards);
  const discount = product.mrp > 0 ? Math.round(((product.mrp - price) / product.mrp) * 100) : 0;
  const savings = product.mrp - price;
  // Entry Prime price (a brand-new Prime member's rate) — shown to guests and
  // non-Prime members so an MRP tag reads as "you can save", not "expensive".
  const isPrime = !!user?.member;
  const primePrice = tierUnitPrice(
    product, 1, { member: true, membershipCount: 1, memberOrderCount: 0 }, settings.rewards
  );
  const showPrimeHint = !isPrime && primePrice > 0 && primePrice < price;
  const hasStockLimit = typeof product.stock === "number";
  const outOfStock = product.inStock === false || (hasStockLimit && product.stock <= 0);
  const lowStock = hasStockLimit && product.stock > 0 && product.stock <= LOW_STOCK;
  const atMax = hasStockLimit && qty >= product.stock;
  const bulkTier = firstBulkTier(product);
  // Only surface pack options when a bulk tier actually beats this shopper's
  // per-unit price. A Prime member's rate can already be lower than every bulk
  // tier — then the packs would all show the same price, which looks pointless,
  // so we show a plain ADD instead.
  const bulkHelps = (product.bulkTiers || []).some(
    (t) => tierUnitPrice(product, Number(t.q), user, settings.rewards) < price
  );
  const [showPacks, setShowPacks] = useState(false);
  const opensPacks = qty === 0 && bulkTier && bulkHelps;

  return (
    <div className={`pcard ${outOfStock ? "is-oos" : ""}`}>
      <div className={`pcard-media ${outOfStock ? "grey" : ""}`}>
        {/* Top-left flag: the discount %, or a custom badge (e.g. "Best price"). */}
        {discount > 0 && !outOfStock ? (
          <span className="pcard-flag">{discount}% OFF</span>
        ) : badge && !outOfStock && !product.hot ? (
          <span className="pcard-flag alt">{badge}</span>
        ) : null}
        {product.hot && !outOfStock && (
          <span className="pcard-star" title="Bestseller" aria-label="Bestseller">★</span>
        )}
        <ProductThumb
          image={product.image}
          name={product.name}
          category={product.category}
          fill
          radius={16}
        />
        {/* Bottom-left chip: low-stock urgency, else the pack size. */}
        {lowStock && !outOfStock ? (
          <span className="pcard-low">
            {product.hot ? "Selling fast · " : ""}Only {product.stock} left
          </span>
        ) : product.unit ? (
          <span className="pcard-unit">{product.unit}</span>
        ) : null}
        {outOfStock && (
          <div className="pcard-oos"><b>Out of stock</b></div>
        )}
        {/* Floating action (in-stock only): ADD → qty stepper, hovering over the
            image's bottom-right corner. */}
        {!outOfStock && (
          qty === 0 ? (
            <button
              className={`pcard-act ${opensPacks ? "has-packs" : ""}`}
              onClick={() => (opensPacks ? setShowPacks(true) : add(product.id, product.stock))}
            >
              ADD{opensPacks && <i>packs ›</i>}
            </button>
          ) : (
            <div className="pcard-step">
              <button onClick={() => remove(product.id)} aria-label="Remove one">−</button>
              <span>{qty}</span>
              <button
                onClick={() => add(product.id, product.stock)}
                disabled={atMax}
                aria-label="Add one"
              >
                +
              </button>
            </div>
          )
        )}
      </div>

      <div className="pcard-body">
        <div className="pcard-name">{product.name}</div>
        {showPrimeHint && !outOfStock && (
          <span className="pcard-prime">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 7l4.5 3L12 4l4.5 6L21 7l-1.8 11H4.8L3 7z" />
            </svg>
            ₹{primePrice} with Prime
          </span>
        )}
        <div className="pcard-pricewrap">
          <div className="pcard-price">
            <span className="pcard-now">₹{price}</span>
            {product.mrp > price && <span className="pcard-was">₹{product.mrp}</span>}
          </div>
          {savings > 0 && !outOfStock && (
            <span className="pcard-save">SAVE ₹{savings}</span>
          )}
          {outOfStock && (
            <button
              className={`pcard-notify ${alerted ? "on" : ""}`}
              onClick={() => {
                if (!user) { window.dispatchEvent(new Event("ngs:require-login")); return; }
                alerts.toggle(product.id);
              }}
            >
              {alerted ? "We'll tell you ✓" : "Notify me"}
            </button>
          )}
        </div>
      </div>

      {showPacks && (
        <BulkPackSheet product={product} onClose={() => setShowPacks(false)} />
      )}
    </div>
  );
}
