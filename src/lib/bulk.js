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

// The per-unit price the shopper actually pays, accounting for NGS Prime member
// pricing. For a member we apply the product's member factor to the bulk unit
// price and clamp to MRP — this MUST mirror place_order() in
// migration-member-pricing.sql so the price shown equals the price charged.
// A non-member (or a neutral product) just gets the normal bulk unit price.
export function unitPriceFor(product, qty, isMember) {
  const base = bulkUnitPrice(product, qty);
  const factor = Number(product?.memberFactor) || 1;
  if (!isMember || factor === 1) return base;
  const mrp = Number(product?.mrp) || 0;
  const adj = Math.round(base * factor);
  return mrp > 0 ? Math.min(adj, mrp) : adj;
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
