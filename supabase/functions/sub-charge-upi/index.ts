// Supabase Edge Function: sub-charge-upi  (UPI Autopay — Phase 3)
// Poked once a day by pg_cron (run_upi_autopay_charges) the evening before each
// delivery. For every upi_autopay plan due to deliver TOMORROW it raises a real
// bank auto-debit against the customer's approved e-mandate.
//
// It NEVER creates a delivery order itself — the order is built only when
// Razorpay confirms the debit was captured, from the razorpay-webhook. So a
// failed or blocked debit can never deliver unpaid milk.
//
// Idempotency lives in the DB: sub_upi_begin_charge claims each (plan, day) via
// a UNIQUE row, so a double poke, a retry, or an overlapping run cannot debit or
// deliver the same day twice.
//
// Secrets: WEBHOOK_SECRET (the cron poke), RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
const rzpAuth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);

async function rpc(fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: sb, body: JSON.stringify(body ?? {}),
  });
  const txt = await res.text();
  let val: unknown = txt;
  try { val = JSON.parse(txt); } catch { /* keep text */ }
  return { ok: res.ok, val };
}

// Tomorrow's date in IST (Asia/Kolkata), as YYYY-MM-DD — the delivery day we
// charge for tonight.
function tomorrowIST(): string {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  nowIst.setUTCDate(nowIst.getUTCDate() + 1);
  return nowIst.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  // Only the cron poke (carrying the shared secret) may run this.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 401 });
  }
  if (!KEY_ID || !KEY_SECRET) return Response.json({ ok: false, error: "payments not configured" });

  const body = await req.json().catch(() => ({}));
  const reconcileOnly = body?.reconcileOnly === true;

  const deliver = tomorrowIST();
  const summary = { deliver, reconcileOnly, reconciled_ok: 0, reconciled_fail: 0, due: 0, charged: 0, skipped: 0, failed: 0 };

  try {
    // ── Reconcile first (every run): any charge stuck 'processing' means its
    // webhook was missed. Ask Razorpay what actually happened and settle it, so a
    // captured-but-unconfirmed debit still delivers and a failed one still skips.
    const { val: stale } = await rpc("sub_upi_stale_charges", {});
    for (const row of (Array.isArray(stale) ? stale : [])) {
      try {
        const pRes = await fetch(`https://api.razorpay.com/v1/orders/${row.rzp_order_id}/payments`, {
          headers: { Authorization: rzpAuth },
        });
        const pj = await pRes.json();
        const items: Array<{ id: string; status: string }> = Array.isArray(pj?.items) ? pj.items : [];
        const captured = items.find((p) => p.status === "captured");
        if (captured) {
          await rpc("sub_upi_settle_success", { p_rzp_order: row.rzp_order_id, p_payment: captured.id });
          summary.reconciled_ok++;
        } else if (items.length > 0 && items.every((p) => p.status === "failed")) {
          await rpc("sub_upi_settle_fail", { p_rzp_order: row.rzp_order_id, p_reason: "reconcile: all attempts failed" });
          summary.reconciled_fail++;
        }
        // else still pending at the bank → leave it for the next sweep.
      } catch { /* transient — retry next sweep */ }
    }

    if (reconcileOnly) return Response.json({ ok: true, ...summary });

    const { val: due } = await rpc("sub_upi_due_list", { p_deliver: deliver });
    const plans: Array<{ id: string }> = Array.isArray(due) ? due : [];
    summary.due = plans.length;

    for (const p of plans) {
      // 1) Claim the day + get the mandate token/amount. Returns [] if ineligible
      //    or already claimed by a concurrent run.
      const { val: begun } = await rpc("sub_upi_begin_charge", { p_plan: p.id, p_deliver: deliver });
      const claim = Array.isArray(begun) ? begun[0] : null;
      if (!claim || !claim.charge_id || !claim.mandate_token) { summary.skipped++; continue; }

      const amountPaise = Math.round(Number(claim.amount) * 100);
      if (!(amountPaise > 0)) { summary.skipped++; continue; }

      try {
        // 2) A Razorpay order for this one debit; notes carry the plan + day so
        //    the webhook can settle it. Auto-captures (recurring default).
        const oRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt: `sub_${p.id.slice(0, 8)}_${deliver}`,
            payment_capture: true,
            notes: { kind: "sub_recurring", subscription_id: p.id, deliver_date: deliver, charge_id: claim.charge_id },
          }),
        });
        const order = await oRes.json();
        if (!oRes.ok || !order?.id) {
          // Couldn't even create the order — no rzp_order_id stored yet, so fail
          // the claimed day by its charge id (skip that day, plan rolls on).
          await rpc("sub_upi_fail_charge", { p_charge: claim.charge_id, p_reason: order?.error?.description || "order create failed" });
          summary.failed++;
          continue;
        }

        // 3) Persist the order id BEFORE the debit, so a fast webhook finds it.
        await rpc("sub_upi_mark_order", { p_charge: claim.charge_id, p_rzp_order: order.id });

        // 4) Raise the actual auto-debit against the approved mandate token.
        const cRes = await fetch("https://api.razorpay.com/v1/payments/create/recurring", {
          method: "POST",
          headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: claim.user_email || "customer@ngsstore.in",
            contact: claim.user_phone ? String(claim.user_phone) : "9999999999",
            amount: amountPaise,
            currency: "INR",
            order_id: order.id,
            customer_id: claim.rzp_customer_id || undefined,
            token: claim.mandate_token,
            recurring: "1",
            description: "NGS daily subscription",
            notes: { kind: "sub_recurring", subscription_id: p.id, deliver_date: deliver },
          }),
        });
        const charge = await cRes.json();
        if (!cRes.ok || !charge?.razorpay_payment_id) {
          // Synchronous reject (bad token, cap exceeded, mandate paused): mark
          // the day failed now so the plan rolls on — the webhook may never come.
          await rpc("sub_upi_settle_fail", { p_rzp_order: order.id, p_reason: charge?.error?.description || "recurring charge rejected" });
          summary.failed++;
          continue;
        }
        // Success is CONFIRMED by the payment.captured webhook (async for UPI),
        // which builds the delivery. We only initiated it here.
        summary.charged++;
      } catch (e) {
        // Network/exception mid-charge — leave the row 'processing'; the webhook
        // still settles it if the debit went through, otherwise a later reconcile
        // sweeps it. Never deliver from here.
        summary.failed++;
        console.error("charge error", p.id, (e as Error).message);
      }
    }

    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, ...summary });
  }
});
