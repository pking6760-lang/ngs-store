// Supabase Edge Function: razorpay-create-qr
// For a not-yet-paid order, the delivery person taps "Show UPI QR" and this
// creates a Razorpay UPI QR Code for the order's REAL total (read from the DB).
// It's a normal UPI QR: the customer scans it with ANY UPI app and pays directly
// — and because it runs through Razorpay, the qr_code.credited webhook confirms
// it and mark_order_paid() flips the order to Paid (turns green live). Admin-only.
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

function callerId(authHeader: string | null): string | null {
  if (!authHeader) return null;
  try {
    const payload = authHeader.replace(/^Bearer\s+/i, "").split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.sub ?? null;
  } catch { return null; }
}

async function isAdmin(uid: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: sbHeaders });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0]?.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_ID || !KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: "Missing order." }, 400);

    const uid = callerId(req.headers.get("Authorization"));
    if (!uid) return json({ error: "Please sign in again." }, 401);
    if (!(await isAdmin(uid))) return json({ error: "Only the store can collect payment." }, 403);

    const oRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,total,human_code,payment_status`,
      { headers: sbHeaders },
    );
    const rows = await oRes.json();
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.payment_status === "paid") return json({ error: "Order already paid." }, 409);

    const amountPaise = Math.round(Number(order.total) * 100);
    if (!(amountPaise > 0)) return json({ error: "Invalid amount." }, 400);

    const auth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);
    const rzpRes = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "upi_qr",
        usage: "single_use",
        fixed_amount: true,
        payment_amount: amountPaise,
        description: `NGS order ${order.human_code}`,
        notes: { order_id: order.id, human_code: order.human_code },
      }),
    });
    const qr = await rzpRes.json();
    if (!rzpRes.ok || !qr?.image_url) {
      return json({ error: qr?.error?.description || "Couldn't create QR." }, 502);
    }

    return json({ imageUrl: qr.image_url, qrId: qr.id, amount: amountPaise });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
