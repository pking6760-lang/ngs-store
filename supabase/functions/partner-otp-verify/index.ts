// Supabase Edge Function: partner-otp-verify
// Verifies the "NGS Partner" code we emailed, then mints a real Supabase login
// by generating a magiclink token_hash (no email sent). The client exchanges
// that token_hash for a session via supabase.auth.verifyOtp.
//
// Secrets: WEBHOOK_SECRET (pepper). Supabase injects SUPABASE_URL + SERVICE_ROLE.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PEPPER = Deno.env.get("WEBHOOK_SECRET") ?? "ngs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sb = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { email, code } = await req.json().catch(() => ({}));
    const clean = String(email || "").trim().toLowerCase();
    const c = String(code || "").trim();
    if (!clean || !/^\d{4,8}$/.test(c)) return json({ error: "Enter the code we emailed you." }, 400);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/partner_otps?email=eq.${encodeURIComponent(clean)}&select=*`, { headers: sb });
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json({ error: "No code found. Please request a new one." }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "Code expired. Request a new one." }, 400);
    if ((row.attempts ?? 0) >= 5) return json({ error: "Too many attempts. Request a new code." }, 429);

    const hash = await sha256hex(`${clean}:${c}:${PEPPER}`);
    if (hash !== row.code_hash) {
      await fetch(`${SUPABASE_URL}/rest/v1/partner_otps?email=eq.${encodeURIComponent(clean)}`, {
        method: "PATCH", headers: { ...sb, "Content-Type": "application/json" },
        body: JSON.stringify({ attempts: (row.attempts ?? 0) + 1 }),
      });
      return json({ error: "Incorrect code. Please try again." }, 400);
    }

    // Correct → ensure the auth user exists, then mint a magiclink token_hash.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { ...sb, "Content-Type": "application/json" },
      body: JSON.stringify({ email: clean, email_confirm: true }),
    }); // 422 if already exists — fine.

    const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers: { ...sb, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: clean }),
    });
    const link = await gl.json();
    const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
    if (!tokenHash) return json({ error: "Couldn't complete login. Try again." }, 500);

    // One-time: delete the used code.
    await fetch(`${SUPABASE_URL}/rest/v1/partner_otps?email=eq.${encodeURIComponent(clean)}`, { method: "DELETE", headers: sb });

    return json({ tokenHash, email: clean });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
