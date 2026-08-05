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
// Razorpay fills placeholder contact/email for QR payments when the payer didn't
// share them — strip those so we only ever show a real number/email.
function payerOf(p: Record<string, unknown>) {
  const contact = String(p.contact || "");
  const email = String(p.email || "");
  const realPhone = contact && !/^\+?9{2}0{5,}/.test(contact.replace(/\D/g, "")) && contact !== "+919000090000";
  const realEmail = email && email !== "void@razorpay.com";
  return {
    paymentId: p.id,
    amount: Number(p.amount) / 100,
    vpa: (p.vpa as string) || null,
    contact: realPhone ? contact : null,
    email: realEmail ? email : null,
    method: (p.method as string) || null,
    createdAt: p.created_at ? Number(p.created_at) * 1000 : null,
  };
}

// Mark our collection row paid from a Razorpay payment object (idempotent-ish:
// only updates a still-pending row).
async function settleRow(qrId: string, p: Record<string, unknown>) {
  const pay = payerOf(p);
  await fetch(`${SUPABASE_URL}/rest/v1/counter_collections?qr_id=eq.${qrId}&status=eq.pending`, {
    method: "PATCH",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "paid", payment_id: pay.paymentId, vpa: pay.vpa, contact: pay.contact,
      email: pay.email, method: pay.method,
      paid_at: pay.createdAt ? new Date(pay.createdAt).toISOString() : new Date().toISOString(),
    }),
  }).catch(() => {});
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
      const label = String(body?.label || "").slice(0, 120);

      // No expiry: the QR stays payable until the customer pays (single-use, so
      // it closes itself on payment) or the admin cancels it.
      const rzpRes = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
        method: "POST",
        headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "upi_qr",
          usage: "single_use",
          fixed_amount: true,
          payment_amount: amountPaise,
          description: label ? `NGS · ${label}` : "NGS counter collection",
          notes: label ? { kind: "counter_collect", label } : { kind: "counter_collect" },
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

      // Record the collection (pending) so it shows in history, and so the
      // webhook can flip it to paid the instant Razorpay confirms.
      await fetch(`${SUPABASE_URL}/rest/v1/counter_collections`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ qr_id: qr.id, amount: rupees, label: label || null, created_by: uid }),
      }).catch(() => {});

      return json({ qrId: qr.id, imageUrl: qr.image_url, imageDataUrl, amount: rupees });
    }

    if (action === "close") {
      const qrId = String(body?.qrId || "");
      if (!qrId) return json({ error: "Missing QR." }, 400);
      // Best-effort: stop a cancelled QR from being payable later.
      await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}/close`, {
        method: "POST", headers: { Authorization: rzpAuth },
      }).catch(() => {});
      return json({ ok: true });
    }

    if (action === "status") {
      const qrId = String(body?.qrId || "");
      if (!qrId) return json({ error: "Missing QR." }, 400);

      // 1) Fastest path: our own row, which the webhook flips to paid the instant
      //    Razorpay confirms — no waiting on Razorpay's slower payments list.
      const rowRes = await fetch(
        `${SUPABASE_URL}/rest/v1/counter_collections?qr_id=eq.${qrId}&select=*`,
        { headers: sbHeaders },
      );
      const rows = await rowRes.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.status === "paid") {
        return json({ paid: true, payment: {
          paymentId: row.payment_id, amount: Number(row.amount),
          vpa: row.vpa || null, contact: row.contact || null, email: row.email || null,
          method: row.method || null, createdAt: row.paid_at ? Date.parse(row.paid_at) : null,
        } });
      }

      // 2) Fallback: ask Razorpay directly (covers the case where the webhook
      //    isn't set up yet), and settle our row if it shows paid.
      const payRes = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}/payments?count=10`, {
        headers: { Authorization: rzpAuth },
      });
      const data = await payRes.json();
      if (payRes.ok) {
        const items: Record<string, unknown>[] = Array.isArray(data?.items) ? data.items : [];
        const paid = items.find((p) => p.status === "captured") || items.find((p) => p.status === "authorized");
        if (paid) {
          const pay = payerOf(paid);
          await settleRow(qrId, paid);
          return json({ paid: true, payment: pay });
        }
      }
      return json({ paid: false });
    }

    if (action === "history") {
      const hRes = await fetch(
        `${SUPABASE_URL}/rest/v1/counter_collections?status=eq.paid&select=*&order=paid_at.desc&limit=50`,
        { headers: sbHeaders },
      );
      const rows = await hRes.json().catch(() => []);
      const items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id, amount: Number(r.amount), label: r.label || null,
        vpa: r.vpa || null, contact: r.contact || null, method: r.method || null,
        paymentId: r.payment_id, paidAt: r.paid_at ? Date.parse(r.paid_at) : null,
      }));
      return json({ items });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
