// Supabase Edge Function: notify-admin
// Triggered by a DB trigger when a row is inserted into public.orders.
// Sends a Firebase Cloud Messaging push to every registered admin device.
// Uses only the built-in fetch + Web Crypto (no external imports) for reliable
// cold-start.
//
// Secrets: FIREBASE_SERVICE_ACCOUNT (json), WEBHOOK_SECRET.
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const svc = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: svc.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })}`;
  const key = await importKey(svc.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token: " + JSON.stringify(data));
  return data.access_token;
}

const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

async function getTokens(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_push_tokens?select=token`, { headers: sbHeaders });
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((r: { token: string }) => r.token) : [];
}

async function deleteTokens(tokens: string[]) {
  if (!tokens.length) return;
  const list = tokens.map((t) => `"${t}"`).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/admin_push_tokens?token=in.(${list})`, {
    method: "DELETE", headers: sbHeaders,
  });
}

async function sendFcm(accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${svc.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: { priority: "high", notification: { sound: "default", channel_id: "orders" } },
          data: { type: "new_order" },
        },
      }),
    },
  );
  return { token, status: res.status };
}

Deno.serve(async (req) => {
  try {
    if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 401 });
    }
    const payload = await req.json().catch(() => ({}));
    const order = payload.record ?? payload;
    if (!order || payload.type === "DELETE") return new Response("skip", { status: 200 });

    const tokens = await getTokens();
    if (!tokens.length) return new Response("no devices", { status: 200 });

    const accessToken = await getAccessToken();
    const title = `🛒 New order ${order.human_code ?? ""}`.trim();
    const body = `${order.customer_name ?? "A customer"} · ₹${order.total ?? ""}`;
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
