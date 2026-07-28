import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings, useProducts } from "../lib/hooks.js";
import { tierUnitPrice } from "../lib/bulk.js";
import { money } from "../lib/money.js";
import { rateText } from "../lib/unitRate.js";
import ProductThumb from "./ProductThumb.jsx";

// Product-detail bottom sheet: product image + price, then selectable pack
// sizes (Zepto/Blinkit style). Pick a pack, then Add — one clean action bar.
export default function BulkPackSheet({ product, onClose }) {
  const { items, setQty } = useCart();
  const { user } = useAuth();
  const settings = useSettings();
  const allProducts = useProducts();
  // A combo is bought as one thing but arrives as several, so the sheet has to
  // say which — otherwise "Kitchen Starter Pack ₹245" tells the customer nothing.
  const comboParts = (Array.isArray(product.comboItems) ? product.comboItems : [])
    .map((c) => ({ qty: Number(c.qty) || 1, p: (allProducts || []).find((x) => x.id === c.id) }))
    .filter((c) => c.p);
  const inCart = items[product.id] || 0;
  const base = Number(product.price) || 0;
  const mrp = Math.max(Number(product.mrp) || 0, base);
  const tiers = Array.isArray(product.bulkTiers) ? product.bulkTiers : [];
  const stock = typeof product.stock === "number" ? product.stock : Infinity;
  // Drop any pack that costs MORE per unit than a smaller one — that would never
  // make sense to buy. A pack at the same per-unit price is kept: on a ₹10
  // biscuit no discount is affordable, but a six-pack is still the thing the
  // shopper came for, and hiding it makes the packs the owner set look broken.
  const rawPacks = [1, ...tiers.map((t) => Number(t.q))].filter((q) => q <= stock || q === 1);
  const packs = [];
  let lastUnit = Infinity;
  for (const q of rawPacks) {
    const u = tierUnitPrice(product, q, user, settings.rewards);
    if (q === 1 || u <= lastUnit) { packs.push(q); lastUnit = u; }
  }

  // The crossed-out reference on every pack is the MRP total (MRP × quantity),
  // so the customer sees the full saving off MRP. (Bulk per-unit prices are
  // still derived from the selling price upstream, in build_bulk_tiers.)
  const refTotal = (q) => mrp * q;

  const [sel, setSel] = useState(inCart && packs.includes(inCart) ? inCart : packs[0]);
  const selUnit = tierUnitPrice(product, sel, user, settings.rewards);
  const selTotal = selUnit * sel;
  const selSave = refTotal(sel) - selTotal;

  // TWO different questions, and the badge needs both.
  //
  // WHICH pack to flag: the one that genuinely beats buying singles at this
  // shopper's own price, by at least a rupee. Measured this way because it is
  // the only test of whether the PACK is doing anything — an MRP saving applies
  // to a single too. No badge unless a pack passes it.
  const singleUnit = tierUnitPrice(product, 1, user, settings.rewards);
  const beatsSingles = (q) => singleUnit * q - tierUnitPrice(product, q, user, settings.rewards) * q;
  const best = packs.reduce(
    (b, q) => (beatsSingles(q) >= 1 && (b === null || beatsSingles(q) > beatsSingles(b)) ? q : b), null);

  // WHAT NUMBER to show: the saving off MRP, for the whole pack — the same basis
  // as everything else on the screen. Rajdhani Besan is ₹159 MRP and the pack of
  // four sells at ₹109 each, so the row prints ₹436 against ₹636 struck through
  // and the badge now says SAVE ₹200, which is exactly 636 − 436. It used to say
  // ₹24, measured against our own selling price — a true number on a basis
  // nothing else used, so it reconciled with nothing the customer could see.
  const packSave = (q) => refTotal(q) - tierUnitPrice(product, q, user, settings.rewards) * q;

  // The ribbon says what it is, then what it's worth. Two states, because one
  // number alone reads as decoration and one label alone says nothing.
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (best === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) return;
    const t = setInterval(() => setFlip((f) => !f), 2600);
    return () => clearInterval(t);
  }, [best]);

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
            {comboParts.length > 0 && (
              <ul className="pd-combo">
                {comboParts.map(({ qty, p }) => (
                  <li key={p.id}><span>{qty}×</span> {p.name}</li>
                ))}
              </ul>
            )}
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
            const isBest = q === best;
            // Price per 100 g / 100 ml / piece — the number that settles
            // "is the bigger one actually cheaper" without any arithmetic.
            const rate = rateText(total, q, product.unit);
            return (
              <button
                type="button"
                key={q}
                className={`pd-pack ${on ? "on" : ""} ${isBest ? "best" : ""}`}
                onClick={() => setSel(q)}
              >
                {isBest && (
                  <span className="pd-pack-ribbon" aria-label={`Best value, saves ₹${money(packSave(q))}`}>
                    <span className={flip ? "off" : ""}>Best value</span>
                    <span className={flip ? "" : "off"}>Save ₹{money(packSave(q))}</span>
                  </span>
                )}
                <span className="pd-pack-radio" aria-hidden="true" />
                <span className="pd-pack-main">
                  <span className="pd-pack-qty">{q === 1 ? "Single" : `Pack of ${q}`}</span>
                  <span className="pd-pack-per">
                    ₹{money(unit)} each{rate ? ` · ${rate}` : ""}
                  </span>
                </span>
                <span className="pd-pack-price">
                  ₹{money(total)}
                  {save > 0 && <s>₹{money(ref)}</s>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="pd-sheet-foot">
          <div className="pd-foot-price">
            <strong>₹{money(selTotal)}</strong>
            {selSave > 0 && <span className="pd-foot-save">Save ₹{money(selSave)}</span>}
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
