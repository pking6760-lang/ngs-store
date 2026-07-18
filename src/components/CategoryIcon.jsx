// Clean line icons for the storefront categories (no emoji). Built-in ids map
// straight to a glyph; admin-added categories are matched by KEYWORDS in their
// id/name so a new category ("Atta, Rice & Dal", "Oil & Ghee", "Sauces …")
// still gets a fitting icon instead of a generic tag.
const PATHS = {
  "dairy-bread": (
    <><path d="M9 2h6M10 2v2.5L8 8v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8l-2-3.5V2" /><path d="M8 11h8" /></>
  ),
  snacks: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  beverages: (
    <><path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 8z" /><path d="M10 8l1-5M15 5l-1 3" /></>
  ),
  instant: (
    <><path d="M3 11h18a9 9 0 0 1-18 0z" /><path d="M8 11c0-3 1.5-5 4-5M12 6V3" /></>
  ),
  bakery: (
    <><path d="M6 11h12l-1.4 8a1 1 0 0 1-1 .9H8.4a1 1 0 0 1-1-.9L6 11z" /><path d="M7 11a5 5 0 0 1 10 0M12 4v2" /></>
  ),
  personal: <path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z" />,
  household: (
    <><path d="M10 9h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" /><path d="M10 9V6h3V4M13 6l3.5-1.2M13 4l3-1" /></>
  ),
  // Grains / staples — a tied sack.
  grains: (
    <><path d="M8 8.5c-2.2.2-2.6 1.8-2.1 3.4l1.5 6.8a2 2 0 0 0 2 1.5h5.2a2 2 0 0 0 2-1.5l1.5-6.8c.5-1.6.1-3.2-2.1-3.4" /><path d="M8 8.5c1-.9 1.2-2 .6-3.2M16 8.5c-1-.9-1.2-2-.6-3.2M8 8.5h8" /><path d="M10.5 13.5l1.5 1.5 1.5-1.5" /></>
  ),
  // Oil / ghee — a bottle with a drop.
  oil: (
    <><path d="M10.5 3h3v2.5h-3z" /><path d="M9.5 5.5h5L15.5 9v10a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V9l1-3.5z" /><path d="M12 12.5c-1 1.3-1.6 2.2-1.6 3a1.6 1.6 0 0 0 3.2 0c0-.8-.6-1.7-1.6-3z" fill="currentColor" stroke="none" /></>
  ),
  // Sauces / spreads / pickles — a lidded jar.
  jar: (
    <><rect x="7" y="8" width="10" height="12" rx="1.6" /><path d="M8 8V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M9.5 12.5h5" /></>
  ),
  // Tobacco / cigarettes — a cigarette with smoke.
  smoke: (
    <><rect x="3" y="13" width="14" height="3.4" rx="0.6" /><path d="M13.5 13v3.4" /><path d="M18.5 5.5c1.3 1 1.3 2.3 0 3.3M15.5 4.5c1.3 1 1.3 2.3 0 3.3" /></>
  ),
  // Fruits / vegetables — an apple.
  produce: (
    <><path d="M12 8.5c-1.8-1.8-6-1-6 3.2 0 3.8 3 7.8 6 7.8s6-4 6-7.8c0-4.2-4.2-5-6-3.2z" /><path d="M12 8.5V5.5a2 2 0 0 1 2-2" /></>
  ),
  // Spices / masala — a shaker.
  spices: (
    <><path d="M8 9.5h8V19a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5z" /><path d="M8 9.5V7.5h8v2" /><path d="M10.5 6.5h3M10.8 13h.01M13.2 13h.01M12 15h.01" /></>
  ),
  // Meat / non-veg — a drumstick.
  meat: (
    <><path d="M13.5 5.5A4 4 0 0 1 18 10c0 2.2-2 3.2-3.2 3.2l-6 6-3-3 6-6C11.8 8.8 11 6 13.5 5.5z" /><path d="M5.2 19.2l-1 1M7.4 17l-1 1" /></>
  ),
  // Baby care — a bottle with teat.
  baby: (
    <><path d="M11 3.5h2v2h-2z" /><path d="M10 5.5h4l.6 2H9.4l.6-2z" /><path d="M9.4 7.5h5.2V19a1 1 0 0 1-1 1H10.4a1 1 0 0 1-1-1V7.5z" /><path d="M10.5 11h3M10.5 13.5h3" /></>
  ),
  // Friendlier fallback than a price tag — a shopping basket.
  default: (
    <><path d="M4 9h16l-1.4 9.6a1 1 0 0 1-1 .9H6.4a1 1 0 0 1-1-.9L4 9z" /><path d="M8.5 9l2-4.5M15.5 9l-2-4.5M9 13v3M15 13v3M12 13v3" /></>
  ),
};

// id/name → keyword-matched glyph.
function pick(id, name) {
  if (PATHS[id]) return PATHS[id];
  const s = `${id || ""} ${name || ""}`.toLowerCase();
  const has = (...w) => w.some((k) => s.includes(k));
  if (has("atta", "rice", "dal", "flour", "grain", "pulse", "wheat", "sugar", "besan", "sooji", "staple")) return PATHS.grains;
  if (has("oil", "ghee", "vanaspati")) return PATHS.oil;
  if (has("sauce", "spread", "ketchup", "jam", "pickle", "achar", "honey", "chutney", "mayon")) return PATHS.jar;
  if (has("tobacco", "cigarette", "cigar", "smoke", "paan", "bidi", "hookah")) return PATHS.smoke;
  if (has("masala", "spice", "salt", "seasoning")) return PATHS.spices;
  if (has("fruit", "vegetable", "veggie", "sabzi", "produce")) return PATHS.produce;
  if (has("meat", "chicken", "fish", "mutton", "non-veg", "nonveg", "egg")) return PATHS.meat;
  if (has("baby", "diaper", "infant", "wipes")) return PATHS.baby;
  if (has("dairy", "milk", "bread", "curd", "paneer", "butter", "cheese")) return PATHS["dairy-bread"];
  if (has("snack", "namkeen", "chip", "biscuit", "munch", "cookie")) return PATHS.snacks;
  if (has("drink", "juice", "beverage", "cola", "soda", "water", "tea", "coffee")) return PATHS.beverages;
  if (has("instant", "frozen", "noodle", "ready", "maggi")) return PATHS.instant;
  if (has("bakery", "sweet", "cake", "pastry", "mithai", "chocolate", "dessert")) return PATHS.bakery;
  if (has("personal", "care", "soap", "shampoo", "hygiene", "beauty", "cosmetic", "grooming")) return PATHS.personal;
  if (has("clean", "household", "detergent", "wash", "home", "utensil")) return PATHS.household;
  return PATHS.default;
}

export default function CategoryIcon({ id, name, size = 26 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {pick(id, name)}
    </svg>
  );
}
