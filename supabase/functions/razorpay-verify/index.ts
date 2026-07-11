// Supabase Edge Function: razorpay-verify
// Called by the browser right after Razorpay reports a successful payment.
// It cryptographically verifies the payment signature with the SECRET key and,
// only if valid, confirms the order via mark_order_paid() (service role).
// The Razorpay webhook is the independent backup for this same step.
//
// Secrets: RAZORPAY_KEY_SECRET, WEBHOOK_SECRET (to call notify-admin).
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish comparison.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function notifyAdmin(order: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "x-webhook-secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify({ record: order }),
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const body = await req.json().catch(() => ({}));
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: "Missing payment details." }, 400);
    }

    // 1) The signature must be HMAC_SHA256(order_id|payment_id) with our secret.
    const expected = await hmacHex(KEY_SECRET, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (!safeEqual(expected, String(razorpay_signature))) {
      return json({ error: "Payment could not be verified." }, 400);
    }

    // 2) The signed Razorpay order must be the one bound to OUR order.
    const oRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`,
      { headers: sbHeaders },
    );
    const rows = await oRes.json();
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.razorpay_order_id !== razorpay_order_id) {
      return json({ error: "Payment does not match this order." }, 400);
    }

    const wasPaid = order.payment_status === "paid";

    // 3) Confirm the order (idempotent, service-role only).
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_order_paid`, {
      method: "POST",
      headers: { ...sbHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_order: orderId, p_payment_id: razorpay_payment_id }),
    });
    if (!rpc.ok) {
      const t = await rpc.text();
      return json({ error: "Confirm failed: " + t }, 500);
    }

    // 4) Alert the shop (only on the first confirmation).
    if (!wasPaid) await notifyAdmin({ ...order, status: "Placed", payment_status: "paid" });

    return json({ ok: true, humanCode: order.human_code });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
