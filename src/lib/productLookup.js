// Look up a scanned barcode (EAN-13 / UPC-A) against the free, open product
// databases so the admin can auto-fill a new product instead of typing it.
//
// We query Open Food Facts first (groceries, drinks, snacks — huge Indian
// coverage), then Open Beauty Facts (personal care: toothpaste, soap, shampoo)
// and finally Open Products Facts (everything else: cleaning, household). All
// three share the same API shape and are free with no key.
//
// Returns { found, name, brand, unit, imageUrl, categoryTags } — imageUrl may
// be empty, and `found` is false when the barcode isn't in any database (the
// admin then just fills the product in by hand).

const DBS = [
  "https://world.openfoodfacts.org",
  "https://world.openbeautyfacts.org",
  "https://world.openproductsfacts.org",
];

const FIELDS = "product_name,product_name_en,brands,quantity,image_url,image_front_url,categories_tags";

async function queryDb(base, barcode) {
  const url = `${base}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const name = (p.product_name_en || p.product_name || "").trim();
  const brand = (p.brands || "").split(",")[0].trim();
  // Prefer a full, brand-prefixed name so "Toothpaste" becomes "Colgate Toothpaste".
  let fullName = name;
  if (brand && name && !name.toLowerCase().includes(brand.toLowerCase())) {
    fullName = `${brand} ${name}`;
  }
  return {
    found: true,
    name: fullName || name || brand,
    brand,
    unit: (p.quantity || "").trim(),
    imageUrl: (p.image_front_url || p.image_url || "").trim(),
    categoryTags: Array.isArray(p.categories_tags) ? p.categories_tags : [],
  };
}

export async function lookupProductByBarcode(barcode) {
  const code = String(barcode || "").trim();
  if (!/^\d{6,14}$/.test(code)) {
    return { found: false, reason: "That doesn't look like a product barcode." };
  }
  for (const base of DBS) {
    try {
      const hit = await queryDb(base, code);
      if (hit) return { ...hit, barcode: code };
    } catch {
      // network hiccup on one DB — try the next.
    }
  }
  return { found: false, barcode: code, reason: "Not in the product database — please fill it in." };
}

// Pick the closest of the store's own categories for a looked-up product, by
// matching keywords from the product name + Open-*-Facts category tags against
// each category's name. Returns a category id, or "" when nothing is confident.
export function guessCategory(lookup, categories) {
  if (!categories?.length) return "";
  const hay = [
    (lookup.name || "").toLowerCase(),
    ...(lookup.categoryTags || []).map((t) => t.replace(/^..:/, "").replace(/-/g, " ").toLowerCase()),
  ].join(" ");

  // Keyword → matches-any list, checked against the store's category names.
  const RULES = [
    { needles: ["cold drink", "juice", "drink", "beverage", "soda", "cola", "water", "tea", "coffee"], cat: ["cold drink", "juice", "beverage", "drink"] },
    { needles: ["snack", "chips", "namkeen", "biscuit", "cookie", "wafer", "munch"], cat: ["snack", "munch", "biscuit"] },
    { needles: ["milk", "dairy", "bread", "egg", "paneer", "cheese", "butter", "curd", "yogurt", "yoghurt"], cat: ["dairy", "bread", "egg", "milk"] },
    { needles: ["toothpaste", "soap", "shampoo", "beauty", "personal care", "deodorant", "cream", "lotion", "hygiene", "toothbrush"], cat: ["personal care", "beauty", "hygiene"] },
    { needles: ["clean", "detergent", "household", "dishwash", "floor", "toilet", "garbage"], cat: ["clean", "household"] },
    { needles: ["frozen", "instant", "noodle", "ready", "maggi", "pasta"], cat: ["frozen", "instant"] },
    { needles: ["bakery", "cake", "muffin", "sweet", "chocolate", "candy"], cat: ["bakery", "sweet"] },
  ];

  for (const rule of RULES) {
    if (rule.needles.some((n) => hay.includes(n))) {
      const match = categories.find((c) =>
        rule.cat.some((k) => c.name.toLowerCase().includes(k))
      );
      if (match) return match.id;
    }
  }
  return "";
}
