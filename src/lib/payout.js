// Mirrors the server's real payout formulas — partner_mark_packed() and
// _complete_delivery() in Postgres — so every admin profit estimate agrees
// with what actually gets paid. Display/estimate only: the server always
// computes and pays the authoritative amount.
//
// Both formulas are solved, not guessed — derived from Delhi minimum wage,
// current fuel cost, and a picking/delivery time model, so net pay per hour
// worked is roughly flat across order sizes and distances instead of swinging
// 8–10× the way flat-rate pay did. See the payout costing note for the maths.

// Delivery pay: base + per-km from the first metre, floored at a minimum so a
// very short hop is still worth accepting. Identical for every order — Prime
// membership is a discount the SHOP gives the customer, funded from item
// margin, never taken out of the rider's pay.
export function riderPay(ops, distanceKm, surging) {
  const base = Number(ops?.rider_base) || 0;
  const perKm = Number(ops?.rider_per_km) || 0;
  const min = Number(ops?.rider_min) || 0;
  const peak = surging ? (Number(ops?.peak_bonus) || 0) : 0;
  return Math.max(base + perKm * (Number(distanceKm) || 0), min) + peak;
}

// Picking pay: base + per line + per unit. Lines drive walking/finding time,
// units drive lifting/bagging time — both already recorded on every order.
export function pickerPay(ops, lines, units) {
  const base = Number(ops?.picker_pack_fee) || 0;
  const perLine = Number(ops?.picker_per_line) || 0;
  const perUnit = Number(ops?.picker_per_unit) || 0;
  return base + perLine * (Number(lines) || 0) + perUnit * (Number(units) || 0);
}

// Line/unit counts from an order's items array, for pickerPay() above.
export function lineUnitCounts(items) {
  const lines = (items || []).length;
  const units = (items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  return { lines, units };
}
