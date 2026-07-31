// Supabase Edge Function: rzp-mandate-create  (UPI Autopay — Phase 1)
// Called after create_subscription_order(pay='upi_autopay') has made a PENDING
// plan + an 'Awaiting payment' umbrella order. This creates a Razorpay customer
// (once per user) and a UPI Autopay MANDATE order, and returns the params the app
// needs to open Razorpay's approval screen. The authorization debit charges the
// customer's first-day basket (their live UPI-PIN approval) — that payment prepays
// the first delivery; the webhook confirms the mandate and confirm_upi_mandate
// schedules that first order.
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
    // The mandate's authorization debit charges the customer's ACTUAL first-day
    // basket (approved live with their UPI PIN). That payment prepays the first
    // delivery — confirm_upi_mandate books it and schedules the order. The per-debit
    // cap is the plan's cap (the exact daily basket).
    const dailyPaise = Math.round(Number(sub.daily_total || 0) * 100);
    const REG_PAISE = Math.max(100, dailyPaise); // never below Razorpay's ₹1 floor
    const capPaise = Math.max(REG_PAISE, Math.round(Number(sub.mandate_max_amount || sub.daily_total || 0) * 100));

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

    // Razorpay's web Checkout can't complete UPI inside an Android WebView, and
    // Supabase can't host a working checkout page (it force-serves text/plain +
    // a sandbox CSP). So we use Razorpay's OWN hosted mandate page: a "registration
    // auth link". The customer opens its short_url in their normal browser (which
    // can launch their UPI app), approves the mandate, and Razorpay fires the same
    // payment.captured we already handle → confirm_upi_mandate stores the token.
    // 'as_presented' lets our engine later debit each day's exact amount up to the cap.
    const expireAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    // Razorpay auth links require an email; synthesise a stable one if absent (no
    // email is sent — email_notify is off).
    const phone10 = String(prof?.phone || "").replace(/\D/g, "").slice(-10);
    const email = prof?.email || (phone10 ? `${phone10}@ngsstore.in` : "customer@ngsstore.in");
    const authRes = await fetch("https://api.razorpay.com/v1/subscription_registration/auth_links", {
      method: "POST",
      headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { name: prof?.name || "NGS Customer", email, contact: prof?.phone ? String(prof.phone) : undefined },
        type: "link",
        amount: REG_PAISE,
        currency: "INR",
        description: "NGS daily subscription — pay for your first delivery + set up UPI Autopay",
        subscription_registration: { method: "upi", max_amount: capPaise, expire_at: expireAt, frequency: "as_presented" },
        receipt: order.human_code ?? order.id,
        email_notify: 0,
        sms_notify: 0,
        expire_by: expireAt,
        notes: { order_id: order.id, subscription_id: order.subscription_id, kind: "mandate" },
      }),
    });
    const auth = await authRes.json();
    if (!authRes.ok || !auth?.short_url || !auth?.order_id) {
      return json({ error: auth?.error?.description || "Couldn't start the mandate." }, 502);
    }

    // Match the approval back to THIS order via the auth transaction's order id.
    await sbPatch(`orders?id=eq.${order.id}`, { razorpay_order_id: auth.order_id });

    // Best-effort: also fetch the direct `upi://mandate?…` intent for THIS order,
    // so the app can open the customer's UPI app straight away instead of routing
    // them through Razorpay's page. This is the exact call Razorpay's own hosted
    // page makes — public key, browser-style, needs no S2S/PCI. If it ever fails
    // (endpoint change, fraud check), the app silently falls back to short_url, so
    // the money flow can never break.
    let intentUrl: string | null = null;
    try {
      const form = new URLSearchParams();
      form.set("key_id", KEY_ID);
      form.set("amount", String(REG_PAISE));
      form.set("currency", "INR");
      form.set("order_id", auth.order_id);
      form.set("customer_id", customerId);
      if (prof?.phone) form.set("contact", String(prof.phone));
      form.set("email", email);
      form.set("method", "upi");
      form.set("recurring", "1");
      form.set("_[flow]", "intent");
      form.set("upi[flow]", "intent");
      form.set("_[source]", "checkoutjs");
      form.set("_[platform]", "browser");
      const aj = await fetch("https://api.razorpay.com/v1/payments/create/ajax", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const ajJson = await aj.json();
      const link = ajJson?.data?.intent_url;
      if (aj.ok && typeof link === "string" && link.startsWith("upi://")) intentUrl = link;
    } catch { /* fall back to the hosted page */ }

    return json({ mandateUrl: auth.short_url, intentUrl, humanCode: order.human_code });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
