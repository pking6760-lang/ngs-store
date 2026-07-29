// Supabase Edge Function: rzp-mandate-create  (UPI Autopay — Phase 1)
// Called after create_subscription_order(pay='upi_autopay') has made a PENDING
// plan + an 'Awaiting payment' umbrella order. This creates a Razorpay customer
// (once per user) and a UPI Autopay MANDATE order, and returns the params the app
// needs to open Razorpay's approval screen. It charges nobody — the customer
// approves the mandate in their UPI app; the webhook confirms and stores it.
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.
const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };
const rzpAuth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);

async function verifiedUid(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE } });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.id ?? null;
  } catch { return null; }
}

async function sbGet(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders });
  return r.ok ? await r.json() : null;
}
async function sbPatch(path: string, body: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_ID || !KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: "Missing order." }, 400);

    const uid = await verifiedUid(req.headers.get("Authorization"));
    if (!uid) return json({ error: "Please sign in again." }, 401);

    // The trusted umbrella order — must be this user's upi_autopay mandate order.
    const rows = await sbGet(`orders?id=eq.${orderId}&select=id,user_id,total,human_code,payment_status,payment_method,is_subscription,subscription_id`);
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.user_id !== uid) return json({ error: "Not your order." }, 403);
    if (order.payment_method !== "upi_autopay" || !order.is_subscription) return json({ error: "Not a mandate order." }, 400);
    if (order.payment_status === "paid") return json({ error: "Mandate already set up." }, 409);

    // The plan carries the bank cap (max per-debit amount).
    const subs = await sbGet(`subscriptions?id=eq.${order.subscription_id}&select=id,mandate_max_amount,daily_total`);
    const sub = Array.isArray(subs) ? subs[0] : null;
    if (!sub) return json({ error: "Plan not found." }, 404);
    const capPaise = Math.round(Number(sub.mandate_max_amount || sub.daily_total || 0) * 100);
    const authPaise = Math.round(Number(order.total) * 100);
    if (!(authPaise > 0) || !(capPaise >= authPaise)) return json({ error: "Invalid mandate amount." }, 400);

    // Reuse (or create) the Razorpay customer for this user.
    const profRows = await sbGet(`profiles?id=eq.${uid}&select=name,phone,email,rzp_customer_id`);
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    let customerId: string | null = prof?.rzp_customer_id ?? null;
    if (!customerId) {
      const cRes = await fetch("https://api.razorpay.com/v1/customers", {
        method: "POST",
        headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: prof?.name || "NGS Customer",
          contact: prof?.phone ? String(prof.phone) : undefined,
          email: prof?.email || undefined,
          fail_existing: "0", // if the contact already exists, return that customer
        }),
      });
      const c = await cRes.json();
      if (!cRes.ok || !c?.id) return json({ error: c?.error?.description || "Couldn't set up autopay customer." }, 502);
      customerId = c.id;
      await sbPatch(`profiles?id=eq.${uid}`, { rzp_customer_id: customerId });
    }

    // The UPI Autopay mandate order. 'as_presented' lets us debit each day's exact
    // amount (up to the cap); expires in a year so short plans never re-ask.
    const expireAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: authPaise,
        currency: "INR",
        receipt: order.human_code ?? order.id,
        customer_id: customerId,
        method: "upi",
        token: { max_amount: capPaise, expire_at: expireAt, frequency: "as_presented" },
        notes: { order_id: order.id, subscription_id: order.subscription_id, kind: "mandate" },
      }),
    });
    const rzp = await rzpRes.json();
    if (!rzpRes.ok || !rzp?.id) return json({ error: rzp?.error?.description || "Couldn't start the mandate." }, 502);

    await sbPatch(`orders?id=eq.${order.id}`, { razorpay_order_id: rzp.id });

    return json({
      keyId: KEY_ID,
      orderId: rzp.id,
      customerId,
      amount: rzp.amount,
      currency: rzp.currency,
      recurring: 1,
      humanCode: order.human_code,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
