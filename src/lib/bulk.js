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

// Line subtotal at the correct bulk unit price.
export function bulkLineTotal(product, qty) {
  return bulkUnitPrice(product, qty) * qty;
}

// The first (smallest-quantity) break, for a "buy N+ at ₹X" teaser. Null if none.
export function firstBulkTier(product) {
  const tiers = Array.isArray(product?.bulkTiers) ? product.bulkTiers : [];
  return tiers.length ? tiers[0] : null;
}
