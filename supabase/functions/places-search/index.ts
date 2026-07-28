// Supabase Edge Function: places-search
//
// Address autocomplete that finds LOCAL LANDMARKS — the village chaupal 90 m
// away, the named gali — the way a maps app does, which the free OpenStreetMap
// data the app falls back to simply does not contain (proven: 0 results for
// "sultanpur choupal" on both Nominatim and Photon).
//
// TWO PROVIDERS, ONE FUNCTION. It uses whichever key is configured:
//   * OLA_MAPS_KEY    -> Ola Maps (Indian, single key, no card to sign up)
//   * GOOGLE_MAPS_KEY -> Google Places (needs Google Cloud billing)
// Ola is tried first when both are set. This lets the shop switch providers by
// changing a secret — never by shipping a new app.
//
// THE KEY NEVER SHIPS IN THE APP. A maps key billed to the owner, sitting inside
// a customer APK, is a bill anyone with an unzip tool can run up. The key lives
// here as a server secret; the phone only ever talks to this function.
//
// GRACEFUL WHEN UNCONFIGURED. With no key set, or on any upstream error, this
// returns { items: null }. The app reads null as "use the free source" and falls
// back to OpenStreetMap, so address entry keeps working before a key is added.

const OLA_KEY = Deno.env.get("OLA_MAPS_KEY") ?? "";
const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function fetchT(url: string, opts: RequestInit = {}, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

type Item = { label: string; lat: number; lng: number };

// A short, human label: the place's own name first ("Chaupal"), then just enough
// of the address to place it — never the full postal tail, which would push the
// useful part off a phone screen.
function joinLabel(name: string, addr: string): string {
  const n = (name || "").trim();
  const a = (addr || "").trim();
  if (!n) return a;
  if (!a) return n;
  if (a.toLowerCase().startsWith(n.toLowerCase())) return a;
  return `${n}, ${a}`;
}

// ── Ola Maps ─────────────────────────────────────────────────────────────────
// Autocomplete returns predictions with the place name AND its coordinates in
// one call, so there is no second "details" request per suggestion.
async function ola(q: string, lat: number, lng: number): Promise<Item[] | null> {
  let url = `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(q)}&api_key=${OLA_KEY}`;
  if (Number.isFinite(lat) && Number.isFinite(lng)) url += `&location=${lat},${lng}`;
  const res = await fetchT(url, {}, 7000);
  if (!res.ok) {
    console.error("ola autocomplete", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  const preds = Array.isArray(data.predictions) ? data.predictions : [];
  return preds
    .map((p: Record<string, unknown>) => {
      const g = ((p.geometry || {}) as { location?: { lat?: number; lng?: number } }).location || {};
      const sf = (p.structured_formatting || {}) as { main_text?: string; secondary_text?: string };
      const label = joinLabel(sf.main_text || "", sf.secondary_text || "") || String(p.description || "");
      return { label, lat: Number(g.lat), lng: Number(g.lng) };
    })
    .filter((s: Item) => s.label && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .slice(0, 6);
}

// ── Google Places (New) ──────────────────────────────────────────────────────
async function google(q: string, lat: number, lng: number): Promise<Item[] | null> {
  const payload: Record<string, unknown> = { textQuery: q, regionCode: "IN", maxResultCount: 6, languageCode: "en" };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    payload.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 30000.0 } };
  }
  const res = await fetchT("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      // Only the three fields we use — the field mask is what Google bills on.
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(payload),
  }, 7000);
  if (!res.ok) {
    console.error("google searchText", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  const places = Array.isArray(data.places) ? data.places : [];
  return places
    .map((p: Record<string, unknown>) => {
      const loc = (p.location || {}) as { latitude?: number; longitude?: number };
      const name = ((p.displayName || {}) as { text?: string }).text || "";
      return { label: joinLabel(name, (p.formattedAddress as string) || ""), lat: Number(loc.latitude), lng: Number(loc.longitude) };
    })
    .filter((s: Item) => s.label && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    if (q.length < 3) return json({ items: [] });

    const lat = Number(body.lat);
    const lng = Number(body.lng);

    // Ola first (Indian, no-card key); Google if that's the one configured.
    if (OLA_KEY) {
      const items = await ola(q, lat, lng);
      if (items) return json({ items });
    }
    if (GOOGLE_KEY) {
      const items = await google(q, lat, lng);
      if (items) return json({ items });
    }
    // Nothing configured, or the configured provider errored → fall back to OSM.
    return json({ items: null });
  } catch (e) {
    console.error("places-search", (e as Error).message);
    return json({ items: null });
  }
});
