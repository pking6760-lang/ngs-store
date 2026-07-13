// Supabase Edge Function: product-lookup
// Given a barcode (and/or a typed name), return product DETAILS — name, brand,
// weight/quantity — to auto-fill a product. No image (the shop uploads its own).
//
// Tries the free Open-*-Facts databases first, then falls back to Gemini with
// Google Search grounding, so Indian local brands that aren't in those
// databases (Mom's Magic, Parle, Mother Dairy, Godrej, cigarettes, mehndi, …)
// are still found via a live web search.
//
// Secret: GEMINI_API_KEY (optional — the web-search fallback is skipped if unset,
// and the function still works off Open Food Facts).

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const OFF_DBS = [
  "https://world.openfoodfacts.org",
  "https://world.openbeautyfacts.org",
  "https://world.openproductsfacts.org",
];
const FIELDS = "product_name,product_name_en,brands,quantity,categories_tags";

async function offLookup(barcode: string) {
  for (const base of OFF_DBS) {
    try {
      const r = await fetch(`${base}/api/v2/product/${barcode}.json?fields=${FIELDS}`);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.status === 1 && d.product) {
        const p = d.product;
        const name = String(p.product_name_en || p.product_name || "").trim();
        const brand = String(p.brands || "").split(",")[0].trim();
        if (name || brand) {
          let full = name;
          if (brand && name && !name.toLowerCase().includes(brand.toLowerCase())) full = `${brand} ${name}`;
          return {
            name: full || brand,
            brand,
            unit: String(p.quantity || "").trim(),
            categoryTags: Array.isArray(p.categories_tags) ? p.categories_tags : [],
            source: "openfoodfacts",
          };
        }
      }
    } catch { /* try next db */ }
  }
  return null;
}

const GEMINI_MODEL = "gemini-flash-latest";

async function geminiCall(prompt: string, useSearch: boolean) {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0 },
  };
  if (useSearch) body.tools = [{ google_search: {} }];
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) return null;
  const d = await r.json();
  const text: string = (d?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text || "").join("");
  return text || null;
}

async function geminiLookup(barcode: string, name: string) {
  if (!GEMINI_KEY) return null;
  const what = name ? `the product named "${name}"` : `the product with barcode (EAN/UPC) ${barcode}`;
  const prompt =
    `You are a product catalog assistant for an Indian grocery store (kirana). ` +
    `Identify ${what}. It is very likely an Indian retail product ` +
    `(brands such as Britannia, Parle, Parle Agro, Mother Dairy, Amul, Anand, Coca-Cola, ` +
    `Pepsi, ITC, Godrej, Tops, and similar, including cigarettes, shampoos and mehndi). ` +
    `Reply with ONLY a compact JSON object and nothing else: ` +
    `{"name":"full product name including brand and flavour/variant","brand":"brand","weight":"net weight or quantity like 100 g, 1 L, 10 pcs"}. ` +
    `If you genuinely cannot identify it, reply {"name":""}.`;
  try {
    // Prefer live Google Search grounding; fall back to the model's own
    // knowledge (covers the major Indian brands) when grounding isn't enabled.
    let text = await geminiCall(prompt, true);
    let source = "web";
    if (!text) { text = await geminiCall(prompt, false); source = "gemini"; }
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (!obj.name) return null;
    return { name: String(obj.name), brand: String(obj.brand || ""), unit: String(obj.weight || ""), categoryTags: [], source };
  } catch {
    return null;
  }
}

// Smart category: fit the product into one of the store's existing categories,
// or propose a short NEW one when none fits. Returns a category NAME; the client
// decides whether it's new by matching it against its own list.
async function classifyCategory(productName: string, brand: string, cats: string[]) {
  if (!GEMINI_KEY || !productName) return "";
  const list = cats.length ? cats.join(", ") : "(none yet)";
  const prompt =
    `You categorize items for an Indian grocery store, quick-commerce style (Blinkit/Zepto). ` +
    `Product: "${brand ? brand + " " : ""}${productName}". ` +
    `The store's existing categories are: ${list}. ` +
    `If the product clearly fits one existing category, reply with that EXACT category name. ` +
    `If none fits well, propose a NEW concise category name in Title Case (2-3 words), ` +
    `e.g. "Tobacco & Cigarettes", "Pooja Needs", "Stationery", "Baby Care", "Pet Care", "Home & Kitchen". ` +
    `Reply with ONLY compact JSON and nothing else: {"category":"the category name"}.`;
  try {
    const text = await geminiCall(prompt, false); // model knowledge is enough
    if (!text) return "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return "";
    const obj = JSON.parse(m[0]);
    return String(obj.category || "").trim();
  } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body.barcode || "").replace(/\D/g, "");
    const typed = String(body.name || "").trim();
    const cats = Array.isArray(body.categories) ? body.categories.map(String) : [];
    if (!code && !typed) return json({ found: false, reason: "No barcode or name." });

    let hit = code ? await offLookup(code) : null;
    if (!hit) hit = await geminiLookup(code, typed);
    if (!hit) return json({ found: false, barcode: code, reason: "Not found — please fill it in." });

    // Suggest the best category (existing or brand-new) for this product.
    const category = await classifyCategory(hit.name, hit.brand || "", cats);
    return json({ found: true, barcode: code, category, ...hit });
  } catch {
    return json({ found: false, reason: "Lookup failed — please fill it in." });
  }
});
