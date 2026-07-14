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
export function lifecycleFor(orderCount, isMember, cfg, membershipCount = 1) {
  const L = cfg?.lifecycle;
  if (!L || L.enabled === false) return { mult: 1, discPct: 0, discMax: 0 };
  const n = (Number(orderCount) || 0) + 1; // this is their n-th order
  const welcomeOrders = L.welcomeOrders ?? 5;
  const taperOrders = Math.max(L.taperOrders ?? 15, 1);
  // Prime is the master (peak) perk; a Normal member gets normalPct% of it.
  const P = L.member || {};
  let boost = P.pointsBoost ?? 2.5;
  let discPct = P.discPct ?? 12;
  let discMax = P.discMax ?? 60;
  // Floor = the % of the peak the perk decays to; differs by tier.
  const fp = L.floorPct || {};
  let floorFrac;
  if (!isMember) {
    const npct = (L.normalPct ?? 55) / 100;
    boost = 1 + (boost - 1) * npct;
    discPct = discPct * npct;
    discMax = Math.round(discMax * npct);
    floorFrac = (fp.normal ?? 3) / 100;
  } else if ((Number(membershipCount) || 1) >= 2) {
    floorFrac = (fp.renew ?? 15) / 100; // renewed member: higher floor (loyalty)
  } else {
    floorFrac = (fp.prime ?? 8) / 100; // first-time Prime
  }
  let frac;
  if (n <= welcomeOrders) frac = 0;
  else if (n <= welcomeOrders + taperOrders) frac = (n - welcomeOrders) / taperOrders;
  else frac = 1;
  const perk = 1 - (1 - floorFrac) * frac; // 100% at welcome → floor% settled
  return { mult: 1 + (boost - 1) * perk, discPct: discPct * perk, discMax };
}

// The welcome discount in ₹ for this order, capped in ₹ and by what's left after
// coupon + points (mirrors the server cap). `net` = item total − coupon − points.
export function welcomeDiscountFor(itemTotal, net, orderCount, isMember, cfg, membershipCount = 1) {
  const { discPct, discMax } = lifecycleFor(orderCount, isMember, cfg, membershipCount);
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
