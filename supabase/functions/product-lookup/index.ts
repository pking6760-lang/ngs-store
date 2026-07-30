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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// This calls the paid Gemini API, so require a signed-in user (the app sends the
// session JWT). Blocks anyone from hammering it with just the public anon key.
async function verifiedUid(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === ANON) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.id ?? null;
  } catch { return null; }
}

const OFF_DBS = [
  "https://world.openfoodfacts.org",
  "https://world.openbeautyfacts.org",
  "https://world.openproductsfacts.org",
];
const FIELDS = "product_name,product_name_en,brands,quantity,categories_tags";

// fetch with a hard timeout so a slow upstream never hangs the whole function.
async function fetchT(url: string, opts: RequestInit = {}, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function offLookup(barcode: string) {
  for (const base of OFF_DBS) {
    try {
      const r = await fetchT(`${base}/api/v2/product/${barcode}.json?fields=${FIELDS}`, {}, 5000);
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
  try {
    const r = await fetchT(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      8000,
    );
    if (!r.ok) return null;
    const d = await r.json();
    const text: string = (d?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text || "").join("");
    return text || null;
  } catch { return null; }
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
    // Single model-knowledge call — fast, covers the major Indian brands, and
    // conserves the (rate-limited) Gemini quota. Grounding search was slower and
    // rate-limited without adding much, so it's no longer used here.
    const text = await geminiCall(prompt, false);
    const source = "gemini";
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    const nm = String(obj.name || "");
    // A real product name has letters. If the model couldn't identify the item
    // and echoed the barcode/digits back, treat it as not found.
    if (!nm || !/[a-z]/i.test(nm)) return null;
    return { name: nm, brand: String(obj.brand || ""), unit: String(obj.weight || ""), categoryTags: [], source };
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
    const uid = await verifiedUid(req.headers.get("Authorization"));
    if (!uid) return json({ found: false, reason: "Please sign in." }, 401);

    const body = await req.json().catch(() => ({}));
    const code = String(body.barcode || "").replace(/\D/g, "");
    const typed = String(body.name || "").trim();
    const cats = Array.isArray(body.categories) ? body.categories.map(String) : [];
    if (!code && !typed) return json({ found: false, reason: "No barcode or name." });

    // Classify from the typed name in parallel with the details lookup, so a
    // name-search returns a category even if product DETAILS can't be found
    // (e.g. tobacco, where the details lookup may come back empty).
    const catFromTyped = typed ? classifyCategory(typed, "", cats) : Promise.resolve("");

    let hit = code ? await offLookup(code) : null;
    if (!hit) hit = await geminiLookup(code, typed);

    let category = await catFromTyped;
    if (!category && hit?.name) category = await classifyCategory(hit.name, hit.brand || "", cats);

    if (!hit) {
      // Details unknown, but we may still have a category suggestion for the name.
      return json({ found: false, barcode: code, category, reason: "Couldn't find full details — fill in name & size." });
    }
    return json({ found: true, barcode: code, category, ...hit });
  } catch {
    return json({ found: false, reason: "Lookup failed — please fill it in." });
  }
});
