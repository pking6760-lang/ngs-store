// Supabase Edge Function: razorpay-webhook
// Razorpay calls this server-to-server when a payment is captured. It is the
// reliable backup for confirming an order: even if the customer closes the app
// the instant after paying (so razorpay-verify never runs), this still confirms
// the order. Idempotent via mark_order_paid().
//
// Secrets: RAZORPAY_WEBHOOK_SECRET, WEBHOOK_SECRET (to call notify-admin).
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
const WEBHOOK_SIG_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NOTIFY_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
        "x-webhook-secret": NOTIFY_SECRET,
      },
      body: JSON.stringify({ record: order }),
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  try {
    const raw = await req.text();
    const sig = req.headers.get("x-razorpay-signature") ?? "";

    // Verify this really came from Razorpay.
    if (!WEBHOOK_SIG_SECRET) return new Response("not configured", { status: 200 });
    const expected = await hmacHex(WEBHOOK_SIG_SECRET, raw);
    if (!safeEqual(expected, sig)) return new Response("bad signature", { status: 401 });

    const event = JSON.parse(raw);
    const type = event?.event ?? "";
    const paymentId = event?.payload?.payment?.entity?.id ?? null;

    // Two ways an order gets paid:
    //  • Online checkout  → payment.captured / order.paid  (match by razorpay_order_id)
    //  • Doorstep link    → payment_link.paid              (match by notes.order_id)
    const rzpOrderId =
      event?.payload?.payment?.entity?.order_id ??
      event?.payload?.order?.entity?.id ??
      null;
    const linkOrderId = event?.payload?.payment_link?.entity?.notes?.order_id ?? null;
    // A doorstep UPI QR being paid.
    const qrOrderId =
      event?.payload?.qr_code?.entity?.notes?.order_id ??
      event?.payload?.payment?.entity?.notes?.order_id ??
      null;

    // UPI Autopay daily debit (Phase 3): these settle against subscription_charges,
    // NOT the orders table — the delivery order doesn't exist until the debit is
    // confirmed here. Matched by the recurring order id we stored when charging.
    // Must run before the orders lookup (payment.failed is otherwise ignored, and
    // a recurring capture has no matching orders row yet).
    if ((type === "payment.captured" || type === "payment.failed") && rzpOrderId) {
      const cRes = await fetch(
        `${SUPABASE_URL}/rest/v1/subscription_charges?rzp_order_id=eq.${rzpOrderId}&select=id`,
        { headers: sbHeaders },
      );
      const crows = await cRes.json();
      const charge = Array.isArray(crows) ? crows[0] : null;
      if (charge) {
        if (type === "payment.captured") {
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/sub_upi_settle_success`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ p_rzp_order: rzpOrderId, p_payment: paymentId }),
          });
        } else {
          const reason = event?.payload?.payment?.entity?.error_description ?? "failed";
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/sub_upi_settle_fail`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ p_rzp_order: rzpOrderId, p_reason: reason }),
          });
        }
        return new Response("recurring settled", { status: 200 });
      }
    }

    let order: Record<string, unknown> | null = null;
    if (type === "qr_code.credited" && qrOrderId) {
      const oRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?id=eq.${qrOrderId}&select=*`,
        { headers: sbHeaders },
      );
      const rows = await oRes.json();
      order = Array.isArray(rows) ? rows[0] : null;
    } else if (type === "payment_link.paid" && linkOrderId) {
      const oRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?id=eq.${linkOrderId}&select=*`,
        { headers: sbHeaders },
      );
      const rows = await oRes.json();
      order = Array.isArray(rows) ? rows[0] : null;
    } else if ((type === "payment.captured" || type === "order.paid") && rzpOrderId) {
      const oRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?razorpay_order_id=eq.${rzpOrderId}&select=*`,
        { headers: sbHeaders },
      );
      const rows = await oRes.json();
      order = Array.isArray(rows) ? rows[0] : null;
    } else {
      return new Response("ignored", { status: 200 });
    }
    if (!order) return new Response("no matching order", { status: 200 });

    // UPI Autopay mandate approval → store the e-mandate token and activate the
    // plan. This is a mandate setup, NOT a normal order payment, so it skips
    // mark_order_paid and never fires the shop's "new order" alarm.
    if (order.payment_method === "upi_autopay" && order.is_subscription) {
      const tokenId = event?.payload?.payment?.entity?.token_id ?? null;
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_upi_mandate`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ p_order_dbid: order.id, p_payment_id: paymentId, p_token: tokenId }),
      });
      return new Response("mandate confirmed", { status: 200 });
    }

    const wasPaid = order.payment_status === "paid";

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_order_paid`, {
      method: "POST",
      headers: { ...sbHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_order: order.id, p_payment_id: paymentId }),
    });

    // Alert the shop ONLY for a genuinely NEW order — i.e. an online order that
    // was "Awaiting payment" and has now been paid, so it enters the queue.
    // A doorstep COD payment (order already Placed/Packed/Out for delivery, the
    // rider just collected via the UPI QR) is NOT a new order, so it must not
    // fire the "new order" alarm on the admin phone.
    const isNewOnlineOrder = order.status === "Awaiting payment";
    if (!wasPaid && isNewOnlineOrder && !order.is_membership && !order.is_topup && !order.is_return) {
      await notifyAdmin({ ...order, status: "Placed", payment_status: "paid" });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    // Always 200 so Razorpay doesn't hammer retries on a transient error.
    return new Response("error: " + (e as Error).message, { status: 200 });
  }
});
