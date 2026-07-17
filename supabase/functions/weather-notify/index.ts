// Supabase Edge Function: weather-notify
// Fires weather-based notifications keyed on each CUSTOMER's own location.
//   1. Reads every customer's default-address lat/lng (weather_customer_locations).
//   2. Buckets them by ~1km grid cell so nearby customers share one weather call.
//   3. Asks Open-Meteo (free, no key) for the current weather per cell.
//   4. Maps each cell to a bucket: 'rain' | 'hot' | 'cold' (none = skip).
//   5. Calls send_weather_bucket() to drop a matching message per user — which
//      the notify-customer trigger then pushes to their phone.
// Dedupe (one message per bucket per day per user) lives in the DB function.
//
// Secret: WEBHOOK_SECRET (poked by pg_cron via run_weather_notify()).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const sb = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

// WMO weather codes that mean precipitation (drizzle/rain/showers/thunderstorm).
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const HOT_FEELS = 38;   // apparent °C at/above → "too hot"
const COLD_FEELS = 8;   // apparent °C at/below → "cold"

type Loc = { user_id: string; lat: number; lng: number };
type Cell = { lat: number; lng: number; users: string[] };

async function rpc(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: sb, body: JSON.stringify(body ?? {}),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

function bucketFor(cur: { precipitation?: number; weather_code?: number; apparent_temperature?: number; temperature_2m?: number }): string | null {
  const precip = Number(cur.precipitation ?? 0);
  const code = Number(cur.weather_code ?? 0);
  const feels = Number(cur.apparent_temperature ?? cur.temperature_2m ?? NaN);
  if (precip > 0.1 || RAIN_CODES.has(code)) return "rain";   // rain wins even if hot
  if (!Number.isNaN(feels) && feels >= HOT_FEELS) return "hot";
  if (!Number.isNaN(feels) && feels <= COLD_FEELS) return "cold";
  return null;
}

// Fetch current weather for many cells in one Open-Meteo call (chunked).
async function fetchWeather(cells: Cell[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let i = 0; i < cells.length; i += 100) {
    const chunk = cells.slice(i, i + 100);
    const lats = chunk.map((c) => c.lat.toFixed(3)).join(",");
    const lngs = chunk.map((c) => c.lng.toFixed(3)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
      `&current=temperature_2m,apparent_temperature,precipitation,weather_code&timezone=auto`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];   // multi → array, single → object
      for (const r of arr) out.push(bucketFor(r?.current ?? {}));
      // pad if the API returned fewer than requested
      while (out.length < i + chunk.length) out.push(null);
    } catch {
      for (let k = 0; k < chunk.length; k++) out.push(null);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 401 });
  }
  try {
    const locs = (await rpc("weather_customer_locations", {})) as Loc[];
    if (!Array.isArray(locs) || locs.length === 0) {
      return Response.json({ ok: true, customers: 0 });
    }

    // Group customers into ~1km grid cells (2-decimal rounding) to batch calls.
    const cellMap = new Map<string, Cell>();
    for (const l of locs) {
      if (typeof l.lat !== "number" || typeof l.lng !== "number") continue;
      const rlat = Math.round(l.lat * 100) / 100;
      const rlng = Math.round(l.lng * 100) / 100;
      const key = `${rlat},${rlng}`;
      let c = cellMap.get(key);
      if (!c) { c = { lat: rlat, lng: rlng, users: [] }; cellMap.set(key, c); }
      c.users.push(l.user_id);
    }
    const cells = [...cellMap.values()];
    const buckets = await fetchWeather(cells);

    // Collect user_ids per bucket.
    const byBucket: Record<string, string[]> = { rain: [], hot: [], cold: [] };
    cells.forEach((c, idx) => {
      const b = buckets[idx];
      if (b && byBucket[b]) byBucket[b].push(...c.users);
    });

    const sent: Record<string, number> = {};
    for (const b of ["rain", "hot", "cold"]) {
      if (byBucket[b].length === 0) continue;
      const n = await rpc("send_weather_bucket", { p_bucket: b, p_user_ids: byBucket[b] });
      sent[b] = typeof n === "number" ? n : 0;
    }
    return Response.json({ ok: true, customers: locs.length, cells: cells.length, sent });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
});
