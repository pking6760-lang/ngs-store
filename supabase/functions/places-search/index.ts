// Supabase Edge Function: places-search
//
// Address autocomplete that finds LOCAL LANDMARKS — the village chaupal 90 m
// away, the specific gali — the way Google Maps does, which the free
// OpenStreetMap data the app used before simply does not contain.
//
// WHY THIS RUNS ON THE SERVER, NOT IN THE APP.
// A Google Maps API key billed to the owner must never ship inside the customer
// APK: anyone can unzip an APK, read the key, and run up his bill. So the key
// lives here as a secret the phone can't see, and the phone only ever talks to
// this function. Google is also told (in the Cloud console) to accept this key
// only from Supabase's servers, so a leaked copy is useless anyway.
//
// COST SHAPE. One Google "Text Search (New)" call per search, debounced on the
// client to fire only when the customer pauses typing. Text Search returns the
// place name AND its coordinates together, so there is no second "details" call
// per suggestion — one request in, up to six places out. At a single shop's
// volume this sits inside Google's monthly free tier.
//
// GRACEFUL WHEN UNCONFIGURED. With no GOOGLE_MAPS_KEY set, or if Google errors,
// this returns { items: null }. The app reads null as "server had nothing" and
// falls back to its OpenStreetMap search, so address entry keeps working before
// the key is ever added — it just won't find the local landmarks until it is.
//
// Secret: GOOGLE_MAPS_KEY (a Google Cloud key with the Places API (New) enabled).

const KEY = Deno.env.get("GOOGLE_MAPS_KEY") ?? "";

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

// A short, human label: the place's own name first ("Chaupal"), then just enough
// of the address to place it ("Sultanpur, New Delhi") — never the full postal
// tail Google returns, which would push the useful part off a phone screen.
function label(name: string, addr: string): string {
  const n = (name || "").trim();
  const a = (addr || "").trim();
  if (!n) return a;
  if (!a) return n;
  // Google's formattedAddress usually starts with the same name — don't repeat it.
  if (a.toLowerCase().startsWith(n.toLowerCase())) return a;
  return `${n}, ${a}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    if (q.length < 3) return json({ items: [] });
    // No key configured → tell the app to use its own fallback.
    if (!KEY) return json({ items: null });

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const hasBias = Number.isFinite(lat) && Number.isFinite(lng);

    const payload: Record<string, unknown> = {
      textQuery: q,
      regionCode: "IN",
      maxResultCount: 6,
      languageCode: "en",
    };
    if (hasBias) {
      // Prefer places near the shop. 30 km is generous — the real delivery gate
      // (3 km) is enforced later by the app against the returned coordinates, so
      // a wide bias here just makes sure a nearby landmark isn't missed.
      payload.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: 30000.0 },
      };
    }

    const res = await fetchT(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": KEY,
          // Only ask for the three fields we use — the field mask is what Google
          // bills against, so requesting less keeps this on the cheapest tier.
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify(payload),
      },
      7000,
    );

    if (!res.ok) {
      // Bad key, quota, API not enabled — let the app fall back rather than fail
      // the whole address step. The real reason is in the function logs.
      const detail = await res.text().catch(() => "");
      console.error("places:searchText", res.status, detail.slice(0, 300));
      return json({ items: null });
    }

    const data = await res.json().catch(() => ({}));
    const items = (Array.isArray(data.places) ? data.places : [])
      .map((p: Record<string, unknown>) => {
        const loc = (p.location || {}) as { latitude?: number; longitude?: number };
        const name = ((p.displayName || {}) as { text?: string }).text || "";
        const addr = (p.formattedAddress as string) || "";
        return { label: label(name, addr), lat: Number(loc.latitude), lng: Number(loc.longitude) };
      })
      .filter((s: { label: string; lat: number; lng: number }) =>
        s.label && Number.isFinite(s.lat) && Number.isFinite(s.lng));

    return json({ items });
  } catch (e) {
    console.error("places-search", (e as Error).message);
    // Any unexpected failure → fall back, never break address entry.
    return json({ items: null });
  }
});
