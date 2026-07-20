// Supabase Edge Function: razorpay-create-order
// Called by the customer's browser AFTER place_order() has created a held
// ('Awaiting payment') order. It reads the order's REAL total from the database
// (never trusting the phone) and creates a matching Razorpay order using the
// secret key, which never leaves the server.
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

// Identify the signed-in caller from the JWT they sent (the "sub" claim is the
// user id), so we only let a customer pay for their OWN order. supabase-js sends
// the session access token in the Authorization header.
async function verifiedUid(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    // Validate the JWT SERVER-SIDE (verifies the signature) rather than trusting
    // a decoded payload — so a forged token can't impersonate another customer.
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.id ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_ID || !KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: "Missing order." }, 400);

    const uid = await verifiedUid(req.headers.get("Authorization"));
    if (!uid) return json({ error: "Please sign in again." }, 401);

    // Read the order (service role) — this total is the trusted amount.
    const oRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,user_id,total,human_code,payment_status`,
      { headers: sbHeaders },
    );
    const rows = await oRes.json();
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.user_id !== uid) return json({ error: "Not your order." }, 403);
    if (order.payment_status === "paid") return json({ error: "Order already paid." }, 409);

    const amountPaise = Math.round(Number(order.total) * 100);
    if (!(amountPaise > 0)) return json({ error: "Invalid amount." }, 400);

    // Create the Razorpay order for the server-computed amount.
    const auth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: order.human_code ?? order.id,
        notes: { order_id: order.id },
      }),
    });
    const rzp = await rzpRes.json();
    if (!rzpRes.ok || !rzp?.id) {
      return json({ error: rzp?.error?.description || "Couldn't start payment." }, 502);
    }

    // Bind the Razorpay order to our order for verification + webhook lookup.
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ razorpay_order_id: rzp.id }),
    });

    return json({
      keyId: KEY_ID,
      orderId: rzp.id,
      amount: rzp.amount,
      currency: rzp.currency,
      humanCode: order.human_code,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
