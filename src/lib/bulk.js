// Quantity-break (bulk) pricing helpers. The per-unit price for a quantity is
// the lowest tier that quantity reaches. This MUST mirror the SQL
// bulk_unit_price() in migration-bulk-order.sql — the order is priced there
// (authoritative); this is only for showing the same numbers to the shopper.

export function bulkUnitPrice(product, qty) {
  const base = Number(product?.price) || 0;
  const tiers = Array.isArray(product?.bulkTiers) ? product.bulkTiers : [];
  let unit = base;
  for (const t of tiers) {
    if (qty >= Number(t.q)) unit = Number(t.price);
  }
  return unit;
}

// Tiered member pricing — the per-unit price this shopper actually pays.
// Every priced product has a public "deep anchor" (memberPriceFloor = cost + a
// minimum margin). The shopper's price sits between the anchor and the MRP at a
// per-tier position that rises after their honeymoon window:
//   New Prime deepest, Renewed Prime middle, Normal member smallest.
// Always the better of this and the bulk/shelf price; guests get the shelf price.
// MUST mirror member_tier_unit() + place_order() in migration-tier-pricing.sql
// so the price shown always equals the price charged.
export function tierUnitPrice(product, qty, user, rewardsCfg) {
  const bulk = bulkUnitPrice(product, qty);
  // Thin-margin staples opt out of member pricing entirely — normal price for all.
  if (product?.noRewards) return bulk;
  const L = rewardsCfg?.lifecycle;
  const P = L?.pricing;
  if (!user || !L || L.enabled === false || !P || P.enabled === false) return bulk;
  const fl = Number(product?.memberPriceFloor) || 0;
  const mrp = Number(product?.mrp) || 0;
  if (!fl || !mrp || mrp <= fl) return bulk;

  const isMember = !!user.member;
  const tier = !isMember ? "normal" : (Number(user.membershipCount) || 1) >= 2 ? "renew" : "prime";
  const T = P[tier] || {};
  const start = T.start ?? (tier === "prime" ? 25 : tier === "renew" ? 50 : 75);
  const end = T.end ?? (tier === "prime" ? 75 : tier === "renew" ? 75 : 100);
  const win = (L.windows || {})[tier] ?? (tier === "prime" ? 10 : tier === "renew" ? 7 : 6);
  const taper = Math.max(L.taperOrders ?? 15, 1);
  const n = (isMember ? user.memberOrderCount || 0 : user.orderCount || 0) + 1;
  let frac;
  if (n <= win) frac = 0;
  else if (n <= win + taper) frac = (n - win) / taper;
  else frac = 1;
  const pct = start + (end - start) * frac;
  const tierP = Math.min(mrp, Math.max(fl, Math.round(fl + ((mrp - fl) * pct) / 100)));
  return Math.min(bulk, tierP);
}

// Line subtotal at the correct bulk unit price.
export function bulkLineTotal(product, qty) {
  return bulkUnitPrice(product, qty) * qty;
}

// The first (smallest-quantity) break, for a "buy N+ at ₹X" teaser. Null if none.
export function firstBulkTier(product) {
  const tiers = Array.isArray(product?.bulkTiers) ? product.bulkTiers : [];
  return tiers.length ? tiers[0] : null;
}
