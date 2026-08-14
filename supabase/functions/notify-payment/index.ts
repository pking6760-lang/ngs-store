// Supabase Edge Function: notify-payment
// Sends a normal push NOTIFICATION to every registered admin device when a
// Store-QR payment is received. Unlike the "new order" alarm (a data-only
// message that wakes the app's full-screen ringer), this uses an FCM
// `notification` block, which Android/iOS display in the tray automatically even
// when the app is closed or killed — so the shop always sees the payment.
//
// Called server-to-server (secret-gated) from razorpay-webhook and the store-qr
// reconciliation, once per newly-recorded payment — so simultaneous payments
// each produce their own notification and nothing is missed.
//
// Secrets: FIREBASE_SERVICE_ACCOUNT (json), WEBHOOK_SECRET.
const svc = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: svc.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const key = await importKey(svc.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token: " + JSON.stringify(data));
  return data.access_token;
}
async function getTokens(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_push_tokens?select=token`, { headers: sbHeaders });
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((r: { token: string }) => r.token) : [];
}
async function deleteTokens(tokens: string[]) {
  if (!tokens.length) return;
  const list = tokens.map((t) => `"${t}"`).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/admin_push_tokens?token=in.(${list})`, { method: "DELETE", headers: sbHeaders });
}
// A displayed notification (shows even when the app is closed) plus a small data
// payload so the app can deep-link to the Store QR screen if it's open.
async function sendFcm(accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${svc.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { type: "store_payment" },
        android: { priority: "high", notification: { default_sound: true, notification_priority: "PRIORITY_HIGH" } },
      },
    }),
  });
  return { token, status: res.status };
}

async function nameFor(vpa: string): Promise<string> {
  if (!vpa) return "";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/payer_names?vpa=eq.${encodeURIComponent(vpa)}&select=name&limit=1`, { headers: sbHeaders });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0]?.name ? String(rows[0].name) : "";
  } catch { return ""; }
}

Deno.serve(async (req) => {
  try {
    if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 401 });
    }
    const { amount, vpa } = await req.json().catch(() => ({}));
    const amt = Math.round(Number(amount) || 0);
    if (!(amt > 0)) return new Response("no amount", { status: 200 });

    const tokens = await getTokens();
    if (!tokens.length) return new Response("no devices", { status: 200 });

    const name = await nameFor(String(vpa || ""));
    const handle = String(vpa || "").split("@")[0];
    const who = name || handle;
    const title = `💰 ₹${amt.toLocaleString("en-IN")} received`;
    const body = who ? `from ${who} · Store QR` : "Store QR payment";

    const accessToken = await getAccessToken();
    const results = await Promise.all(tokens.map((t) => sendFcm(accessToken, t, title, body)));
    const dead = results.filter((r) => r.status === 404 || r.status === 400).map((r) => r.token);
    await deleteTokens(dead);
    return new Response(JSON.stringify({ sent: results.length, dead: dead.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("error: " + (e as Error).message, { status: 200 });
  }
});
