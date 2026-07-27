// "Is the bigger pack actually cheaper?" answered in one number.
//
// A shopper comparing ₹58.50 for six 60 g biscuits against ₹123 for a 250 ml can
// is doing arithmetic in their head at the exact moment we want them deciding.
// A rate per 100 g / 100 ml / piece removes the arithmetic, and it is the one
// number that makes a bulk pack's value self-evident without anybody having to
// claim anything.
//
import { money } from "./money.js";

// The pack size lives in a free-text field the owner types — "250 ml", "45gm",
// "20 pcs ", "1kg", "4 × 90g" — so this parses what is really there rather than
// what a schema wishes were there. When it can't parse, it returns null and the
// screen simply shows nothing: a wrong rate is far worse than no rate.

const UNITS = [
  // [pattern, base unit, multiplier to the base]
  [/^(kgs?|kilograms?)$/, "g", 1000],
  [/^(gm?s?|grams?)$/, "g", 1],
  [/^(l|ltr?s?|litres?|liters?)$/, "ml", 1000],
  [/^(ml|mls|millilitres?|milliliters?)$/, "ml", 1],
  [/^(pcs?|pieces?|nos?|units?)$/, "pc", 1],
];

// "500 g" → { qty: 500, unit: "g" } · "4 × 90g" → { qty: 360, unit: "g" }
export function parseUnit(text) {
  const raw = String(text || "").toLowerCase().trim();
  if (!raw) return null;

  // A multipack written out — "4 x 90g", "4 × 90 g".
  let mult = 1;
  let body = raw;
  const m = body.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(.+)$/);
  if (m) { mult = Number(m[1]) || 1; body = m[2]; }

  const n = body.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (!n) return null;
  const qty = Number(n[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  for (const [re, unit, factor] of UNITS) {
    if (re.test(n[2])) return { qty: qty * factor * mult, unit };
  }
  return null;
}

// What the shopper pays per comparable amount. `total` is the price for
// `packQty` of a product whose pack size is `unitText`.
//   rateFor(58.5, 6, "60 g")  → { value: 16.25, label: "per 100 g" }
//   rateFor(123, 1, "250 ml") → { value: 49.2,  label: "per 100 ml" }
//   rateFor(400, 4, "20 pcs") → { value: 5,     label: "per piece" }
export function rateFor(total, packQty, unitText) {
  const u = parseUnit(unitText);
  const t = Number(total);
  const q = Number(packQty) || 1;
  if (!u || !Number.isFinite(t) || t <= 0) return null;
  const amount = u.qty * q;
  if (!(amount > 0)) return null;

  if (u.unit === "pc") {
    return { value: t / amount, label: amount === q ? "per piece" : "per piece", per: 1, unit: "pc" };
  }
  // Per 100 for weights and volumes — the size Indian packaging compares at.
  return { value: (t / amount) * 100, label: `per 100 ${u.unit}`, per: 100, unit: u.unit };
}

// Formatted for display. Paise are shown in full or not at all — "₹13.5" reads
// as a typo where "₹13.50" reads as a price. Above ₹100 the paise stop carrying
// information, so they go.
export function rateText(total, packQty, unitText) {
  const r = rateFor(total, packQty, unitText);
  if (!r) return null;
  const v = r.value >= 100 ? Math.round(r.value) : Math.round(r.value * 100) / 100;
  return `₹${money(v)} ${r.label}`;
}
