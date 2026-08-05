// Supabase Edge Function: soundbox-poll
// The physical soundbox device calls this every few seconds. It returns the most
// recent PAID counter collection (id + amount). The device remembers the last id
// it announced; when a new id appears, it fetches the spoken line from
// soundbox-tts and plays it. Auth is a shared device key (?key=...).
//
// Secrets: SOUNDBOX_KEY (Supabase injects SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
const SOUNDBOX_KEY = Deno.env.get("SOUNDBOX_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!SOUNDBOX_KEY || key !== SOUNDBOX_KEY) return new Response("unauthorized", { status: 401 });

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/counter_collections?status=eq.paid&select=id,amount,paid_at&order=paid_at.desc&limit=1`,
    { headers: sbHeaders },
  );
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const body = row
    ? { id: row.id, amount: Math.round(Number(row.amount)), paidAt: row.paid_at }
    : {};
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
