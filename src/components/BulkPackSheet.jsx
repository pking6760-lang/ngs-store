import { useState } from "react";
import { createPortal } from "react-dom";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../lib/hooks.js";
import { tierUnitPrice } from "../lib/bulk.js";
import ProductThumb from "./ProductThumb.jsx";

// Product-detail bottom sheet: product image + price, then selectable pack
// sizes (Zepto/Blinkit style). Pick a pack, then Add — one clean action bar.
export default function BulkPackSheet({ product, onClose }) {
  const { items, setQty } = useCart();
  const { user } = useAuth();
  const settings = useSettings();
  const inCart = items[product.id] || 0;
  const base = Number(product.price) || 0;
  const mrp = Math.max(Number(product.mrp) || 0, base);
  const tiers = Array.isArray(product.bulkTiers) ? product.bulkTiers : [];
  const stock = typeof product.stock === "number" ? product.stock : Infinity;
  // Only keep packs that actually lower THIS shopper's per-unit price. A member's
  // rate can already match a bulk tier, which would otherwise show identical-price
  // packs — so we drop any pack that doesn't beat the previous one.
  const rawPacks = [1, ...tiers.map((t) => Number(t.q))].filter((q) => q <= stock || q === 1);
  const packs = [];
  let lastUnit = Infinity;
  for (const q of rawPacks) {
    const u = tierUnitPrice(product, q, user, settings.rewards);
    if (q === 1 || u < lastUnit) { packs.push(q); lastUnit = u; }
  }

  // The customer's "first price" is the SELLING price. MRP is only the crossed
  // price on a single unit (the MRP discount). Bulk packs, though, discount
  // FROM the selling price — so a pack's saving is measured against buying that
  // many units at the normal selling price, not against MRP.
  const refTotal = (q) => (q === 1 ? mrp : base) * q;

  const [sel, setSel] = useState(inCart && packs.includes(inCart) ? inCart : packs[0]);
  const selUnit = tierUnitPrice(product, sel, user, settings.rewards);
  const selTotal = selUnit * sel;
  const selSave = refTotal(sel) - selTotal;

  function add() {
    setQty(product.id, Math.min(sel, stock));
    onClose();
  }

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="pd-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pd-sheet-grip" />
        <button className="pd-sheet-x" onClick={onClose} aria-label="Close">✕</button>

        <div className="pd-hero">
          <div className="pd-hero-img">
            <ProductThumb image={product.image} name={product.name} category={product.category} fill radius={16} />
          </div>
          <div className="pd-hero-info">
            <div className="pd-hero-name">{product.name}</div>
            {product.unit && <div className="pd-hero-unit">{product.unit}</div>}
            <div className="pd-hero-eta">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
              12 min delivery
            </div>
          </div>
        </div>

        <div className="pd-packs-title">{packs.length > 1 ? "Choose a pack" : "Quantity"}</div>
        <div className="pd-packs">
          {packs.map((q) => {
            const unit = tierUnitPrice(product, q, user, settings.rewards);
            const total = unit * q;
            const ref = refTotal(q);
            const save = ref - total;
            const on = sel === q;
            return (
              <button
                type="button"
                key={q}
                className={`pd-pack ${on ? "on" : ""}`}
                onClick={() => setSel(q)}
              >
                <span className="pd-pack-radio" aria-hidden="true" />
                <span className="pd-pack-main">
                  <span className="pd-pack-qty">Pack of {q}</span>
                  <span className="pd-pack-per">₹{unit} / unit{save > 0 ? ` · save ₹${save}` : ""}</span>
                </span>
                <span className="pd-pack-price">
                  ₹{total}
                  {save > 0 && <s>₹{ref}</s>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="pd-sheet-foot">
          <div className="pd-foot-price">
            <strong>₹{selTotal}</strong>
            {selSave > 0 && <span className="pd-foot-save">Save ₹{selSave}</span>}
          </div>
          <button className="pd-foot-add" onClick={add}>
            {inCart === sel ? "Update cart" : "Add to cart"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
