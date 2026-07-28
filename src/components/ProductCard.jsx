import { useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../lib/hooks.js";
import ProductThumb from "./ProductThumb.jsx";
import { firstBulkTier, tierUnitPrice } from "../lib/bulk.js";
import { money } from "../lib/money.js";
import BulkPackSheet from "./BulkPackSheet.jsx";
import { useStockAlerts } from "../lib/stockAlerts.js";
import { recordView } from "../lib/recentViews.js";
import { flashActive, fmtCountdown, useFlashCountdown } from "../lib/flash.js";
import { useT } from "../lib/i18n.jsx";

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
  const { t } = useT();
  const qty = items[product.id] || 0;
  // A live flash sale ticks down; when it hits zero this re-renders and the
  // normal price returns on its own (the server does the same at checkout).
  const flashLeft = useFlashCountdown(product.flashEndsAt);
  const onFlash = flashActive(product) && flashLeft > 0;
  // The price this shopper actually pays. A flash price is flat for everyone —
  // no member/bulk discount stacks on it, exactly as the server charges.
  const price = onFlash ? product.flashPrice : tierUnitPrice(product, 1, user, settings.rewards);
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
  // Surface pack options unless every tier would cost this shopper MORE per unit
  // than a single — that can happen once a Prime rate is already below the bulk
  // price, and offering a worse deal is pointless. Equal is still worth showing:
  // on a ₹10 biscuit no discount is affordable, but "pack of 6" is exactly what
  // the shopper wants to tap.
  const bulkHelps = (product.bulkTiers || []).some(
    (t) => tierUnitPrice(product, Number(t.q), user, settings.rewards) <= price
  );
  const [showPacks, setShowPacks] = useState(false);
  // A flash price is flat, so packs (which are just bulk discounts) don't apply
  // during a flash — the ADD button adds straight to the cart.
  const opensPacks = qty === 0 && bulkTier && bulkHelps && !onFlash;

  return (
    <div className={`pcard ${outOfStock ? "is-oos" : ""}`}>
      <div className={`pcard-media ${outOfStock ? "grey" : ""}`}>
        {/* Top-left flag: a live flash countdown wins; else the discount %, or a
            custom badge (e.g. "Best price"). */}
        {onFlash && !outOfStock ? (
          <span className="pcard-flag flash">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
            {fmtCountdown(flashLeft)}
          </span>
        ) : discount > 0 && !outOfStock ? (
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
          <div className="pcard-oos"><b>{t("Out of stock")}</b></div>
        )}
        {/* Floating action (in-stock only): ADD → qty stepper, hovering over the
            image's bottom-right corner. */}
        {!outOfStock && (
          qty === 0 ? (
            <button
              className={`pcard-act ${opensPacks ? "has-packs" : ""}`}
              onClick={() => { recordView(product.id); opensPacks ? setShowPacks(true) : add(product.id, product.stock); }}
            >
              {t("ADD")}{opensPacks && <i>packs ›</i>}
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
            ₹{money(primePrice)} with Prime
          </span>
        )}
        <div className="pcard-pricewrap">
          <div className="pcard-price">
            <span className="pcard-now">₹{money(price)}</span>
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
              {alerted ? t("We'll tell you ✓") : t("Notify me")}
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
