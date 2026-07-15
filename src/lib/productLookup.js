// Look up product DETAILS (name / brand / weight) so the admin can auto-fill a
// product instead of typing it. The actual lookup runs server-side in the
// product-lookup edge function (Open Food Facts, then Gemini web search for
// Indian local brands). No image — the shop uploads its own photo.
//
// Returns { found, name, brand, unit, categoryTags } — `found` is false when
// nothing could be identified (the admin then fills it in by hand).

import { lookupProductDetails } from "./api.js";

// A real product name always has letters. Some lookups (e.g. an AI that can't
// identify the item) echo the barcode or digits back as the "name" — reject
// those so the barcode number never lands in the Product name field.
const hasRealName = (n) => /[a-z]/i.test(String(n || ""));

export async function lookupProductByBarcode(barcode, categoryNames) {
  const code = String(barcode || "").trim();
  if (!/^\d{6,14}$/.test(code)) {
    return { found: false, reason: "That doesn't look like a product barcode." };
  }
  try {
    const res = await lookupProductDetails(code, "", categoryNames);
    if (res && res.found && hasRealName(res.name)) return res;
    // Details weren't usable (or the "name" was just the barcode). Keep any
    // category suggestion, but make the owner type the name.
    return {
      found: false,
      barcode: code,
      category: res?.category,
      reason: res?.found ? "Couldn't read the name — please type it." : (res?.reason || "Not found — please fill it in."),
    };
  } catch {
    return { found: false, barcode: code, reason: "Lookup failed — please fill it in." };
  }
}

// Look up by a typed product name (no barcode) — pure web search via Gemini.
export async function lookupProductByName(name, categoryNames) {
  const q = String(name || "").trim();
  if (q.length < 3) return { found: false, reason: "Type a bit more of the name." };
  try {
    const res = await lookupProductDetails("", q, categoryNames);
    if (res && res.found && hasRealName(res.name)) return res;
    return { found: false, category: res?.category, reason: res?.reason || "Couldn't find that — fill it in." };
  } catch {
    return { found: false, reason: "Lookup failed — fill it in." };
  }
}

const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Resolve the server's suggested category NAME against the store's categories.
// Returns { id } for an existing match, or { newName } to propose creating it.
export function resolveSuggestedCategory(suggestedName, categories) {
  const s = String(suggestedName || "").trim();
  if (!s) return null;
  const target = norm(s);
  const existing = (categories || []).find((c) => norm(c.name) === target);
  if (existing) return { id: existing.id };
  return { newName: s };
}

// Offline fallback: propose a NEW category from the product name for common
// kirana items that rarely fit the starter categories — used when the AI
// classifier returns nothing (e.g. it's unavailable or declined tobacco).
const NEW_CATEGORY_RULES = [
  { needles: ["cigarette", "gold flake", "classic", "marlboro", "tobacco", "bidi", "beedi", "gutkha", "gutka", "hookah", "navy cut", "wills", "capstan", "flake"], name: "Tobacco & Cigarettes" },
  { needles: ["agarbatti", "incense", "dhoop", "camphor", "kapoor", "pooja", "puja", "diya", "matchbox", "match box", "matches"], name: "Pooja Needs" },
  { needles: ["pen", "pencil", "notebook", "eraser", "stapler", "sketch", "stationery", "sharpener", "geometry box"], name: "Stationery" },
  { needles: ["diaper", "pampers", "baby wipe", "baby lotion", "cerelac"], name: "Baby Care" },
  { needles: ["dog food", "cat food", "pedigree", "whiskas", "pet "], name: "Pet Care" },
  { needles: ["condom", "sanitary", "sanitary pad", "tampon", "stayfree", "whisper", "nappy"], name: "Personal Hygiene" },
  { needles: ["mosquito", "all out", "good knight", "hit spray", "cockroach", "repellent"], name: "Repellents & Fresheners" },
];
export function proposeNewCategory(name, categories) {
  const hay = norm(name);
  if (!hay) return null;
  for (const rule of NEW_CATEGORY_RULES) {
    if (rule.needles.some((n) => hay.includes(norm(n)))) {
      const exists = (categories || []).find((c) => norm(c.name) === norm(rule.name));
      return exists ? { id: exists.id } : { newName: rule.name };
    }
  }
  return null;
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
