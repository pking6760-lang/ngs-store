// Supabase Edge Function: call-ring
// Fired by place-call RPCs (via pg_net) the instant someone starts an in-app
// VoIP call. Pushes a high-priority DATA message to every device the callee owns
// — native (customer_devices / partner_devices) and web (customer_devices FCM
// web tokens) — so their app/browser shows the incoming-call screen even when
// closed. The audio itself is peer-to-peer WebRTC; this only wakes the callee.
//
// Secrets: FIREBASE_SERVICE_ACCOUNT (json), WEBHOOK_SECRET.
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
const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

async function col(table: string, userId: string, colName: string): Promise<string[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}&select=${colName}`, { headers: sbHeaders });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.map((r: Record<string, string>) => r[colName]).filter(Boolean) : [];
}
// Every device the callee owns, across customer / partner / admin token stores.
async function calleeTokens(userId: string): Promise<string[]> {
  const [cust, part, adm] = await Promise.all([
    col("customer_devices", userId, "fcm_token"),
    col("partner_devices", userId, "fcm_token"),
    col("admin_push_tokens", userId, "token"),
  ]);
  return [...new Set([...cust, ...part, ...adm])];
}

async function sendFcm(accessToken: string, token: string, data: Record<string, string>) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${svc.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    // DATA-ONLY, high priority. Native: NgsFcmService wakes the incoming-call
    // screen. Web: firebase-messaging-sw.js onBackgroundMessage shows the ring
    // notification (with Answer / Decline actions). TTL 30s — a call is only
    // worth ringing briefly; a stale push should never resurrect a dead call.
    body: JSON.stringify({
      message: {
        token,
        android: { priority: "high", ttl: "30s" },
        webpush: { headers: { TTL: "30", Urgency: "high" } },
        data,
      },
    }),
  });
  return { token, status: res.status };
}

Deno.serve(async (req) => {
  try {
    if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 401 });
    }
    const p = await req.json().catch(() => ({}));
    if (!p.calleeId || !p.callId) return new Response("bad", { status: 200 });
    const tokens = await calleeTokens(p.calleeId);
    if (!tokens.length) return new Response("no devices", { status: 200 });

    const accessToken = await getAccessToken();
    const caller = String(p.callerName ?? "NGS");
    const data: Record<string, string> = {
      type: "incoming_call",
      callId: String(p.callId),
      callerName: caller,
      callerRole: String(p.callerRole ?? ""),
      title: `📞 ${caller} is calling`,
      body: "Tap to answer in the app",
    };
    const results = await Promise.all(tokens.map((t) => sendFcm(accessToken, t, data)));
    return new Response(JSON.stringify({ sent: results.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("error: " + (e as Error).message, { status: 200 });
  }
});
