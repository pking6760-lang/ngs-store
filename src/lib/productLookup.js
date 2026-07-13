// Look up product DETAILS (name / brand / weight) so the admin can auto-fill a
// product instead of typing it. The actual lookup runs server-side in the
// product-lookup edge function (Open Food Facts, then Gemini web search for
// Indian local brands). No image — the shop uploads its own photo.
//
// Returns { found, name, brand, unit, categoryTags } — `found` is false when
// nothing could be identified (the admin then fills it in by hand).

import { lookupProductDetails } from "./api.js";

export async function lookupProductByBarcode(barcode, categoryNames) {
  const code = String(barcode || "").trim();
  if (!/^\d{6,14}$/.test(code)) {
    return { found: false, reason: "That doesn't look like a product barcode." };
  }
  try {
    const res = await lookupProductDetails(code, "", categoryNames);
    if (res && res.found) return res;
    return { found: false, barcode: code, reason: res?.reason || "Not found — please fill it in." };
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
    if (res && res.found) return res;
    return { found: false, reason: res?.reason || "Couldn't find that — fill it in." };
  } catch {
    return { found: false, reason: "Lookup failed — fill it in." };
  }
}

// Resolve the server's suggested category NAME against the store's categories.
// Returns { id } for an existing match, or { newName } to propose creating it.
export function resolveSuggestedCategory(suggestedName, categories) {
  const s = String(suggestedName || "").trim();
  if (!s) return null;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(s);
  const existing = (categories || []).find((c) => norm(c.name) === target);
  if (existing) return { id: existing.id };
  return { newName: s };
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
