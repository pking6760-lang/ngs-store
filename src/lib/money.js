// One way to write a price, everywhere.
//
// Bulk pack prices can now land on 25-paise steps — a ₹10 biscuit whose margin
// only allows ₹9.75 for a six-pack. Printed with plain string conversion that
// becomes "₹58.5" for a ₹58.50 total, which reads like a bug and, on a bill,
// looks like a shop that cannot count.
//
// Whole rupees stay whole: ₹60 does not become ₹60.00. Anything with paise
// always shows both places.
export function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  // Round to paise first so 58.499999 from a stray float never prints 58.5.
  const paise = Math.round(n * 100);
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

// With the rupee sign, for the common case.
export function rs(v) {
  return `₹${money(v)}`;
}
