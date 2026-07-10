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

export const MEMBERSHIP = {
  name: "NGS Prime",
  price: 199, // one-time for the demo (a real setup would bill monthly)
  benefits: [
    "Free delivery on normal days",
    "First priority on every order",
    "Member-only offers",
  ],
};
