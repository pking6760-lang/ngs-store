// Supabase Edge Function: store-qr
// The shop's STANDING UPI QR — a permanent Paytm/PhonePe-style soundbox QR that
// never expires, unlike the per-sale "collect payment" QR. Admin only.
//
// Actions (POST { action, ... }):
//   { action: "get" }                     -> the OPEN QR (any amount). Created
//                                            once on first call, reused forever.
//   { action: "list" }                    -> all saved store QRs (open + fixed),
//                                            each with paid count + total.
//   { action: "createFixed", amount, label } -> a permanent fixed-amount QR.
//   { action: "history", qrId? }          -> paid payments for one QR (or all
//                                            store QRs), newest first.
//   { action: "sync", qrId? }             -> pull recent payments from Razorpay
//                                            and record any new ones (safety net
//                                            when the webhook isn't set up, and
//                                            the live feed the screen polls).
//   { action: "remove", id }              -> close + delete a saved FIXED QR.
//
// Every store-QR payment is written into counter_collections (status=paid,
// notes.kind='store_qr'), which is exactly what soundbox-poll reads — so the
// physical soundbox announces store-QR payments automatically.
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
// Shared secret for the scheduled reconciliation cron (no user JWT).
const CRON_SECRET = Deno.env.get("STORE_QR_CRON_SECRET") ?? "";
const NOTIFY_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

// Fire-and-forget closed-app push when THIS path is the first to record a
// payment (e.g. the webhook dropped the event). Deduped by the insert succeeding.
function notifyPayment(amount: number, vpa: string | null) {
  if (!NOTIFY_SECRET) return;
  fetch(`${SUPABASE_URL}/functions/v1/notify-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, "x-webhook-secret": NOTIFY_SECRET },
    body: JSON.stringify({ amount, vpa: vpa || "" }),
  }).catch(() => {});
}

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

// Razorpay's image host sends no CORS headers, so inline the PNG as base64 for
// offline-safe display; the browser reads the UPI code out of it to redraw a
// clean QR and to render download/share posters at any size.
async function inlineImage(url: string): Promise<string> {
  try {
    const r = await fetch(url);
    if (!r.ok) return "";
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch { return ""; }
}

// Create a Razorpay UPI QR that never expires (no close_by) and can be paid many
// times (usage=multiple_use). fixedAmount=null → the payer types the amount.
async function createRzpQr(uid: string, fixedRupees: number | null, label: string) {
  const body: Record<string, unknown> = {
    type: "upi_qr",
    name: label || "NGS Store",
    usage: "multiple_use",
    fixed_amount: fixedRupees != null,
    description: label ? `NGS Store · ${label}` : "NGS Store",
    notes: { kind: "store_qr", created_by: uid, label: label || "" },
  };
  if (fixedRupees != null) body.payment_amount = Math.round(fixedRupees * 100);
  const res = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
    method: "POST",
    headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const qr = await res.json();
  if (!res.ok || !qr?.image_url) throw new Error(qr?.error?.description || "Couldn't create QR.");
  return qr;
}

async function saveRow(row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/store_qrs`, {
    method: "POST",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
}

function outRow(r: Record<string, unknown>) {
  return {
    id: r.id, qrId: r.rzp_qr_id, kind: r.kind,
    amount: r.amount != null ? Number(r.amount) : null,
    label: r.label || null, imageUrl: r.image_url || null,
    imageDataUrl: r.image_data || null, createdAt: r.created_at ? Date.parse(String(r.created_at)) : null,
  };
}

// Strip Razorpay's placeholder contact/email so we only surface real ones.
function payerOf(p: Record<string, unknown>) {
  const contact = String(p.contact || "");
  const email = String(p.email || "");
  const realPhone = contact && contact !== "+919000090000" && !/^\+?9{2}0{5,}/.test(contact.replace(/\D/g, ""));
  const realEmail = email && email !== "void@razorpay.com";
  return {
    paymentId: String(p.id || ""),
    amount: Number(p.amount || 0) / 100,
    vpa: (p.vpa as string) || null,
    contact: realPhone ? contact : null,
    email: realEmail ? email : null,
    method: (p.method as string) || null,
    createdAt: p.created_at ? Number(p.created_at) * 1000 : Date.now(),
  };
}

// Pull recent captured payments for a QR from Razorpay and insert any we haven't
// recorded yet (dedup by payment_id). Returns the payments now on record.
async function syncQr(qr: Record<string, unknown>) {
  const qrId = String(qr.rzp_qr_id);
  const seenRes = await fetch(
    `${SUPABASE_URL}/rest/v1/counter_collections?qr_id=eq.${qrId}&select=payment_id`,
    { headers: sbHeaders },
  );
  const seen = new Set((await seenRes.json().catch(() => [])).map((r: Record<string, unknown>) => r.payment_id));

  const payRes = await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}/payments?count=25`, {
    headers: { Authorization: rzpAuth },
  });
  const data = await payRes.json().catch(() => ({}));
  const items: Record<string, unknown>[] = payRes.ok && Array.isArray(data?.items) ? data.items : [];
  const fresh = items.filter((p) => p.status === "captured" && !seen.has(p.id));
  let added = 0;
  const errors: string[] = [];
  for (const p of fresh) {
    const pay = payerOf(p);
    try {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/counter_collections`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          qr_id: qrId, amount: pay.amount, label: (qr.label as string) || "Store QR",
          created_by: qr.created_by || null, status: "paid", payment_id: pay.paymentId,
          vpa: pay.vpa, contact: pay.contact, email: pay.email, method: pay.method,
          paid_at: new Date(pay.createdAt).toISOString(),
        }),
      });
      if (ins.ok) { added++; notifyPayment(pay.amount, pay.vpa); }
      else errors.push(`${ins.status}: ${(await ins.text()).slice(0, 200)}`);
    } catch (e) { errors.push(String((e as Error).message).slice(0, 200)); }
  }
  return { added, errors };
}

async function historyFor(qrId: string | null) {
  const filter = qrId ? `qr_id=eq.${qrId}&` : "";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/counter_collections?${filter}status=eq.paid&select=*&order=paid_at.desc&limit=100`,
    { headers: sbHeaders },
  );
  const rows = await res.json().catch(() => []);
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id, qrId: r.qr_id, amount: Number(r.amount), label: r.label || null,
    vpa: r.vpa || null, contact: r.contact || null, method: r.method || null,
    paymentId: r.payment_id, paidAt: r.paid_at ? Date.parse(r.paid_at) : null,
    name: null as string | null,
  }));
  // Enrich with saved payer names (the "name book"), matched by VPA.
  const vpas = [...new Set(list.map((x) => x.vpa).filter(Boolean))] as string[];
  if (vpas.length) {
    const inList = vpas.map((v) => `"${v}"`).join(",");
    const nRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payer_names?vpa=in.(${inList})&select=vpa,name`,
      { headers: sbHeaders },
    );
    const names = await nRes.json().catch(() => []);
    const map = new Map((Array.isArray(names) ? names : []).map((n: Record<string, unknown>) => [n.vpa, n.name]));
    for (const x of list) if (x.vpa && map.has(x.vpa)) x.name = String(map.get(x.vpa));
  }
  return list;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY_ID || !KEY_SECRET) return json({ error: "Payments are not configured yet." }, 503);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    // Scheduled reconciliation: a server-side cron calls this every minute with
    // a shared secret (no user JWT). It pulls any payments the webhook missed
    // into the DB, so history + soundbox never depend on a flaky webhook. This
    // is the reliability backstop for Razorpay not always delivering
    // qr_code.credited.
    if (action === "sync" && CRON_SECRET && req.headers.get("x-store-cron") === CRON_SECRET) {
      const qRes = await fetch(
        `${SUPABASE_URL}/rest/v1/store_qrs?select=rzp_qr_id,label,created_by`,
        { headers: sbHeaders },
      );
      const qrs = await qRes.json().catch(() => []);
      let added = 0; const errors: string[] = [];
      for (const q of (Array.isArray(qrs) ? qrs : [])) {
        const r = await syncQr(q); added += r.added; errors.push(...r.errors);
      }
      return json({ added, errors });
    }

    const uid = await verifiedUid(req.headers.get("Authorization"));
    if (!uid) return json({ error: "Please sign in again." }, 401);
    if (!(await isAdmin(uid))) return json({ error: "Admins only." }, 403);

    if (action === "get") {
      // Reuse the one OPEN QR if it already exists; otherwise mint it once.
      const exRes = await fetch(
        `${SUPABASE_URL}/rest/v1/store_qrs?kind=eq.open&select=*&limit=1`,
        { headers: sbHeaders },
      );
      const exRows = await exRes.json().catch(() => []);
      let row = Array.isArray(exRows) ? exRows[0] : null;
      if (!row) {
        const qr = await createRzpQr(uid, null, "");
        const imageData = await inlineImage(qr.image_url);
        row = await saveRow({
          rzp_qr_id: qr.id, kind: "open", amount: null, label: null,
          image_url: qr.image_url, image_data: imageData, created_by: uid,
        });
        if (!row) return json({ error: "Couldn't save the QR." }, 500);
      }
      return json({ qr: outRow(row) });
    }

    if (action === "createFixed") {
      const rupees = Number(body?.amount);
      if (!(rupees > 0)) return json({ error: "Enter a valid amount." }, 400);
      if (rupees > 200000) return json({ error: "Amount is too large." }, 400);
      const label = String(body?.label || "").slice(0, 80);
      const qr = await createRzpQr(uid, rupees, label);
      const imageData = await inlineImage(qr.image_url);
      const row = await saveRow({
        rzp_qr_id: qr.id, kind: "fixed", amount: rupees, label: label || null,
        image_url: qr.image_url, image_data: imageData, created_by: uid,
      });
      if (!row) return json({ error: "Couldn't save the QR." }, 500);
      return json({ qr: outRow(row) });
    }

    if (action === "list") {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/store_qrs?select=*&order=kind.asc,created_at.desc`,
        { headers: sbHeaders },
      );
      const rows = await res.json().catch(() => []);
      // Attach paid count + total per QR.
      const withStats = await Promise.all((Array.isArray(rows) ? rows : []).map(async (r) => {
        const hRes = await fetch(
          `${SUPABASE_URL}/rest/v1/counter_collections?qr_id=eq.${r.rzp_qr_id}&status=eq.paid&select=amount`,
          { headers: sbHeaders },
        );
        const hs = await hRes.json().catch(() => []);
        const paidCount = Array.isArray(hs) ? hs.length : 0;
        const paidTotal = Array.isArray(hs) ? hs.reduce((s: number, x: Record<string, unknown>) => s + Number(x.amount || 0), 0) : 0;
        return { ...outRow(r), paidCount, paidTotal };
      }));
      return json({ items: withStats });
    }

    if (action === "history") {
      const qrId = body?.qrId ? String(body.qrId) : null;
      return json({ items: await historyFor(qrId) });
    }

    // Name book: save (or clear) the name for a payer's UPI ID. Once set, every
    // past and future payment from that VPA shows the name and the soundbox
    // announces it.
    if (action === "setName") {
      const vpa = String(body?.vpa || "").trim();
      const name = String(body?.name || "").trim().slice(0, 60);
      if (!vpa) return json({ error: "Missing UPI ID." }, 400);
      if (!name) {
        await fetch(`${SUPABASE_URL}/rest/v1/payer_names?vpa=eq.${encodeURIComponent(vpa)}`, {
          method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" },
        });
        return json({ ok: true, name: null });
      }
      // Upsert on the vpa primary key.
      await fetch(`${SUPABASE_URL}/rest/v1/payer_names`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ vpa, name, created_by: uid, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true, name });
    }

    if (action === "sync") {
      // Sync the requested QR (or every store QR), then return fresh history.
      const qrId = body?.qrId ? String(body.qrId) : null;
      const qRes = await fetch(
        `${SUPABASE_URL}/rest/v1/store_qrs?select=rzp_qr_id,label,created_by${qrId ? `&rzp_qr_id=eq.${qrId}` : ""}`,
        { headers: sbHeaders },
      );
      const qrs = await qRes.json().catch(() => []);
      let added = 0;
      for (const q of (Array.isArray(qrs) ? qrs : [])) added += (await syncQr(q)).added;
      return json({ added, items: await historyFor(qrId) });
    }

    if (action === "remove") {
      const id = String(body?.id || "");
      if (!id) return json({ error: "Missing QR." }, 400);
      const rowRes = await fetch(
        `${SUPABASE_URL}/rest/v1/store_qrs?id=eq.${id}&select=rzp_qr_id,kind&limit=1`,
        { headers: sbHeaders },
      );
      const rows = await rowRes.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return json({ error: "QR not found." }, 404);
      if (row.kind === "open") return json({ error: "The main store QR can't be deleted." }, 400);
      // Best-effort close on Razorpay so it can't be paid after removal.
      await fetch(`https://api.razorpay.com/v1/payments/qr_codes/${row.rzp_qr_id}/close`, {
        method: "POST", headers: { Authorization: rzpAuth },
      }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/store_qrs?id=eq.${id}`, {
        method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" },
      }).catch(() => {});
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
