// Supabase Edge Function: store-automation
// The store's auto-pilot tick. Runs every ~10 min (poked by pg_cron):
//   1. store_automation_snapshot()  → hours window + live peak from order rate.
//   2. If rain-surge is on, look up the CURRENT weather at the shop (Open-Meteo,
//      free, no key) → is it raining?
//   3. desired surge = (peak on & peak now) OR (rain on & raining now).
//   4. store_automation_apply(open_now, surge) → writes store_open / delivery_mode,
//      honouring the per-dimension on-flags and any 2-hour manual hold (DB-side).
//
// Secret: WEBHOOK_SECRET (poked by run_store_automation()).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const sb = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

// WMO codes that mean real rain (moderate+). Light drizzle (51/53/56) is a
// trace that shouldn't trigger a delivery surge, so it's deliberately excluded.
const RAIN_CODES = new Set([55, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

async function rpc(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: sb, body: JSON.stringify(body ?? {}),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function isRaining(lat: number, lng: number): Promise<boolean> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
    `&longitude=${lng.toFixed(4)}&current=precipitation,weather_code&timezone=auto`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const cur = data?.current ?? {};
    const precip = Number(cur.precipitation ?? 0);
    const code = Number(cur.weather_code ?? 0);
    // Firmer threshold so a trace of drizzle doesn't trigger surge. Real rain is
    // ≥ 0.4mm in the slot OR a definite precipitation weather-code.
    return precip >= 0.4 || RAIN_CODES.has(code);
  } catch {
    return false;   // never surge on a failed weather call
  }
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 401 });
  }
  try {
    const snap = await rpc("store_automation_snapshot", {});
    if (!snap || typeof snap !== "object") {
      return Response.json({ ok: false, error: "no snapshot" }, { status: 200 });
    }
    const auto = snap.automation ?? {};
    const peakOn = !!auto?.peak?.on;
    const rainOn = !!auto?.rain?.on;

    let raining = false;
    const lat = snap.shop_lat != null ? Number(snap.shop_lat) : NaN;
    const lng = snap.shop_lng != null ? Number(snap.shop_lng) : NaN;
    if (rainOn && Number.isFinite(lat) && Number.isFinite(lng)) {
      const rawRaining = await isRaining(lat, lng);
      // Debounce so surge doesn't flap on a flickering reading: needs a couple of
      // consecutive wet reads to turn on, and a couple of dry reads to turn off.
      const deb = await rpc("weather_debounce", { p_raw: rawRaining });
      raining = deb === true;
    }

    const surge = (peakOn && !!snap.peak_now) || (rainOn && raining);
    const open = !!snap.open_now;
    const applied = await rpc("store_automation_apply", { p_open: open, p_surge: surge });

    return Response.json({
      ok: true, open, surge, raining, peak_now: !!snap.peak_now,
      recent_orders: snap.recent_orders, applied,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
});
