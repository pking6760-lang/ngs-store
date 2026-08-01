// Supabase Edge Function: razorpay-collect-qr
// A POS-style "collect payment" flow for the shop (admin only), NOT tied to an
// order. Two actions:
//   { action: "create", amount }  -> makes a fixed-amount UPI QR for that rupee
//                                     amount and returns it to display.
//   { action: "status", qrId }    -> polls Razorpay; when a payment lands it
//                                     returns paid:true plus the payer's details
//                                     (VPA, phone, amount, time) so the admin
//                                     screen can close the QR and show a receipt.
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (Supabase injects SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY).
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
const rzpAuth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);

async function verifiedUid(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.id ?? null;
  } catch { return null; }
}
async function isAdmin(uid: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role`, { headers: sbHeaders });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0]?.role === "admin";
}

// Turn a Razorpay payment object into the small "who paid" summary we show.
function payerOf(p: Record<string, unknown>) {
  return {
    paymentId: p.id,
    amount: Number(p.amount) / 100,
    vpa: (p.vpa as string) || null,
    contact: (p.contact as string) || null,
    email: (p.email as string) || null,
    method: (p.method as string) || null,
    createdAt: p.created_at ? Number(p.created_at) * 1000 : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_ID || !KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    const uid = await verifiedUid(req.headers.get("Authorization"));
    if (!uid) return json({ error: "Please sign in again." }, 401);
    if (!(await isAdmin(uid))) return json({ error: "Admins only." }, 403);

    if (action === "create") {
      const rupees = Number(body?.amount);
      if (!(rupees > 0)) return json({ error: "Enter a valid amount." }, 400);
      if (rupees > 200000) return json({ error: "Amount is too large." }, 400);
      const amountPaise = Math.round(rupees * 100);

      // 15-minute life (Razorpay needs close_by >= now + 2 min).
      const closeBy = Math.floor(Date.now() / 1000) + 15 * 60;
      const rzpRes = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
        method: "POST",
        headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "upi_qr",
          usage: "single_use",
          fixed_amount: true,
          payment_amount: amountPaise,
          description: "NGS counter collection",
          close_by: closeBy,
          notes: { kind: "counter_collect" },
        }),
      });
      const qr = await rzpRes.json();
      if (!rzpRes.ok || !qr?.image_url) {
        return json({ error: qr?.error?.description || "Couldn't create QR." }, 502);
      }

      // Razorpay's image host sends no CORS headers, so inline it as base64 for
      // a reliable, offline-friendly display.
      let imageDataUrl = "";
      try {
        const imgRes = await fetch(qr.image_url);
        if (imgRes.ok) {
          const buf = new Uint8Array(await imgRes.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          imageDataUrl = `data:image/png;base64,${btoa(bin)}`;
        }
      } catch { /* client falls back to imageUrl */ }

      return json({ qrId: qr.id, imageUrl: qr.image_url, imageDataUrl, amount: rupees, closeBy: qr.close_by || closeBy });
    }

    if (action === "status") {
      const qrId = String(body?.qrId || "");
      if (!qrId) return json({ error: "Missing QR." }, 400);
      const payRes = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}/payments?count=10`, {
        headers: { Authorization: rzpAuth },
      });
      const data = await payRes.json();
      if (!payRes.ok) return json({ error: data?.error?.description || "Couldn't check status." }, 502);
      const items: Record<string, unknown>[] = Array.isArray(data?.items) ? data.items : [];
      const paid = items.find((p) => p.status === "captured") || items.find((p) => p.status === "authorized");
      if (paid) return json({ paid: true, payment: payerOf(paid) });

      // Not paid yet — also report whether the QR has lapsed.
      const qrRes = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}`, {
        headers: { Authorization: rzpAuth },
      });
      const qr = await qrRes.json().catch(() => ({}));
      return json({ paid: false, closed: qr?.status === "closed" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
