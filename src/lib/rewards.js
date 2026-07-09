// Reward points + membership rules for NGS Store.
// Tweak these numbers to change the whole program in one place.

export const POINTS = {
  // Earn ~50 points for every ₹99 spent ("buy worth 99, get 50 points").
  earnRate: 50 / 99,
  // 10 points = ₹1 when redeemed.
  perRupee: 10,
};

// Points earned for a given spend (whole points).
export function pointsForSpend(amount) {
  return Math.floor(amount * POINTS.earnRate);
}

// Rupee value of a points balance when redeemed (whole rupees).
export function redeemableRupees(points) {
  return Math.floor(points / POINTS.perRupee);
}

// Points needed to redeem a given rupee amount.
export function pointsForRupees(rupees) {
  return rupees * POINTS.perRupee;
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
