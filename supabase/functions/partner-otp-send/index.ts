// Supabase Edge Function: partner-otp-send
// Sends a branded "NGS Partner" login code via Brevo (separate from the customer
// login). Generates our own 6-digit code, stores it hashed with a 10-minute
// expiry, and emails it. partner-otp-verify checks it and mints a session.
//
// Secrets: BREVO_API_KEY, BREVO_SENDER (verified sender email), WEBHOOK_SECRET (pepper).
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER = Deno.env.get("BREVO_SENDER") ?? "";
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
    if (!BREVO_API_KEY || !BREVO_SENDER) return json({ error: "Partner email is not configured yet." }, 503);
    const { email } = await req.json().catch(() => ({}));
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return json({ error: "Enter a valid email address." }, 400);

    // ── Rate limit: 60s cooldown + max 5 codes per rolling hour, per email. ──
    // Stops inbox spam and the "resend to reset the wrong-guess counter" bypass.
    const COOLDOWN_MS = 60 * 1000;
    const WINDOW_MS = 60 * 60 * 1000;
    const MAX_PER_WINDOW = 5;
    const now = Date.now();
    const ex = await fetch(
      `${SUPABASE_URL}/rest/v1/partner_otps?email=eq.${encodeURIComponent(clean)}&select=last_sent_at,sends_in_window,window_start`,
      { headers: sb },
    );
    const exRow = (await ex.json().catch(() => []))?.[0] ?? null;
    let sends_in_window = 1;
    let window_start = new Date(now).toISOString();
    if (exRow) {
      const last = exRow.last_sent_at ? new Date(exRow.last_sent_at).getTime() : 0;
      if (now - last < COOLDOWN_MS) {
        return json({ error: "Please wait a minute before requesting another code." }, 429);
      }
      const winStart = exRow.window_start ? new Date(exRow.window_start).getTime() : 0;
      if (now - winStart < WINDOW_MS) {
        if ((exRow.sends_in_window ?? 0) >= MAX_PER_WINDOW) {
          return json({ error: "Too many codes requested. Please try again later." }, 429);
        }
        sends_in_window = (exRow.sends_in_window ?? 0) + 1;
        window_start = new Date(winStart).toISOString();
      }
    }

    // 6-digit code, valid 10 minutes.
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const code_hash = await sha256hex(`${clean}:${code}:${PEPPER}`);
    const expires_at = new Date(now + 10 * 60 * 1000).toISOString();

    const up = await fetch(`${SUPABASE_URL}/rest/v1/partner_otps`, {
      method: "POST",
      headers: { ...sb, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        email: clean, code_hash, expires_at, attempts: 0,
        last_sent_at: new Date(now).toISOString(), sends_in_window, window_start,
      }),
    });
    if (!up.ok) return json({ error: "Couldn't start login. Try again." }, 500);

    // Branded NGS Partner email via Brevo.
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "NGS Partner", email: BREVO_SENDER },
        to: [{ email: clean }],
        subject: "Your NGS Partner login code",
        htmlContent:
          `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto">
             <h2 style="color:#0a7a44;margin-bottom:4px">NGS Partner</h2>
             <p style="color:#555">Your login code for the NGS Partner app:</p>
             <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#111;margin:14px 0">${code}</div>
             <p style="color:#888;font-size:13px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
           </div>`,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: "Couldn't send the email: " + t.slice(0, 120) }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
