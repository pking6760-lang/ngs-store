import { useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../lib/hooks.js";
import ProductThumb from "./ProductThumb.jsx";
import { firstBulkTier, tierUnitPrice } from "../lib/bulk.js";
import BulkPackSheet from "./BulkPackSheet.jsx";

// Show scarcity urgency when stock is running low.
const LOW_STOCK = 5;

export default function ProductCard({ product, badge }) {
  const { items, add, remove } = useCart();
  const { user } = useAuth();
  const settings = useSettings();
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
  const [showPacks, setShowPacks] = useState(false);

  return (
    <div className={`product-card ${outOfStock ? "sold-out" : ""}`}>
      <div className="product-image">
        <ProductThumb
          image={product.image}
          name={product.name}
          category={product.category}
          fill
          radius={14}
        />
        {/* Show the "Best price" tag only when there's no discount ribbon, so the
            two never collide in the same corner on a narrow card. */}
        {badge && !outOfStock && discount === 0 && (
          <span className="product-best">{badge}</span>
        )}
        {discount > 0 && !outOfStock && (
          <span className="product-badge">
            <span className="product-badge-inner">
              <b>{discount}%</b> OFF
            </span>
          </span>
        )}
        <span className="product-delivery">12 min</span>
        {lowStock && !outOfStock && (
          <span className="product-lowstock">
            {product.hot ? "Selling fast · " : ""}Only {product.stock} left
          </span>
        )}
        {outOfStock && <span className="sold-out-tag">Out of stock</span>}
      </div>
      <div className="product-name">{product.name}</div>
      <div className="product-unit">
        {product.unit}
        {product.hot && !lowStock && !outOfStock && (
          <span className="product-hot">Bestseller</span>
        )}
      </div>
      {showPacks && (
        <BulkPackSheet product={product} onClose={() => setShowPacks(false)} />
      )}
      <div className="product-footer">
        <div className="product-price">
          <div className="price-line">
            <span className="price-now">₹{price}</span>
            {product.mrp > price && (
              <span className="price-mrp">₹{product.mrp}</span>
            )}
          </div>
          {savings > 0 && !outOfStock && (
            <span className="save-pill">Save ₹{savings}</span>
          )}
          {showPrimeHint && !outOfStock && (
            <span className="prime-hint">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 7l4.5 3L12 4l4.5 6L21 7l-1.8 11H4.8L3 7z" />
              </svg>
              ₹{primePrice} with Prime
            </span>
          )}
        </div>
        {outOfStock ? (
          <button className="add-btn out" disabled>
            Sold out
          </button>
        ) : qty === 0 && bulkTier ? (
          <div className="add-wrap">
            <button className="add-btn" onClick={() => setShowPacks(true)}>
              ADD
            </button>
            <span className="add-opts">{product.bulkTiers.length + 1} options</span>
          </div>
        ) : qty === 0 ? (
          <button className="add-btn" onClick={() => add(product.id, product.stock)}>
            ADD
          </button>
        ) : (
          <div className="qty-stepper">
            <button onClick={() => remove(product.id)} aria-label="Remove one">
              −
            </button>
            <span>{qty}</span>
            <button
              onClick={() => add(product.id, product.stock)}
              disabled={atMax}
              aria-label="Add one"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
