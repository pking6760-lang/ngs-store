// Reward points + membership rules for NGS Store.
// The earning rule is configurable from the admin (Offers → Reward points):
//   earn `earnPoints` for every `earnPer` rupees spent, and
//   `redeemPer` points = ₹1 when redeemed.
export const DEFAULT_REWARDS = {
  earnPoints: 50, // points earned…
  earnPer: 399, // …for every ₹399 spent
  redeemPer: 10, // 10 points = ₹1
};

// Merge a saved config with defaults so missing fields never break the maths.
export function rewardsConfig(cfg) {
  return { ...DEFAULT_REWARDS, ...(cfg || {}) };
}

// Points earned for a given spend (whole points).
export function pointsForSpend(amount, cfg) {
  const { earnPoints, earnPer } = rewardsConfig(cfg);
  if (!earnPer || earnPer <= 0) return 0;
  return Math.floor((amount / earnPer) * earnPoints);
}

// Rupee value of a points balance when redeemed (whole rupees).
export function redeemableRupees(points, cfg) {
  const { redeemPer } = rewardsConfig(cfg);
  if (!redeemPer || redeemPer <= 0) return 0;
  return Math.floor(points / redeemPer);
}

// Points needed to redeem a given rupee amount.
export function pointsForRupees(rupees, cfg) {
  return rupees * rewardsConfig(cfg).redeemPer;
}

// New-customer lifecycle: a boost that tapers with order count to a non-zero
// floor. Mirrors place_order() in migration-customer-lifecycle.sql so the client
// shows exactly the welcome discount the server charges. `cfg` is settings.rewards.
export function lifecycleFor(orderCount, isMember, cfg) {
  const L = cfg?.lifecycle;
  if (!L || L.enabled === false) return { mult: 1, discPct: 0, discMax: 0 };
  const n = (Number(orderCount) || 0) + 1; // this is their n-th order
  const welcomeOrders = L.welcomeOrders ?? 5;
  const taperOrders = Math.max(L.taperOrders ?? 15, 1);
  const t = (isMember ? L.member : L.nonmember) || {};
  const boost = t.pointsBoost ?? (isMember ? 2.0 : 1.5);
  const floor = t.pointsFloor ?? (isMember ? 1.3 : 1.0);
  const discPct = t.discPct ?? (isMember ? 10 : 6);
  const discFloor = t.discFloorPct ?? (isMember ? 2 : 0);
  let frac;
  if (n <= welcomeOrders) frac = 0;
  else if (n <= welcomeOrders + taperOrders) frac = (n - welcomeOrders) / taperOrders;
  else frac = 1;
  return {
    mult: boost - (boost - floor) * frac,
    discPct: discPct - (discPct - discFloor) * frac,
    discMax: t.discMax ?? (isMember ? 50 : 30),
  };
}

// The welcome discount in ₹ for this order, capped in ₹ and by what's left after
// coupon + points (mirrors the server cap). `net` = item total − coupon − points.
export function welcomeDiscountFor(itemTotal, net, orderCount, isMember, cfg) {
  const { discPct, discMax } = lifecycleFor(orderCount, isMember, cfg);
  if (!(discPct > 0) || !(itemTotal > 0)) return 0;
  return Math.max(0, Math.min(Math.round((itemTotal * discPct) / 100), discMax, Math.max(0, net)));
}

export const MEMBERSHIP = {
  name: "NGS Prime",
  price: 199, // one-time for the demo (a real setup would bill monthly)
  benefits: [
    "Free delivery on normal days",
    "First priority on every order",
    "Member-only offers",
  ],
};
