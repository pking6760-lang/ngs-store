// Supabase Edge Function: sub-charge-upi  (UPI Autopay — Phase 9, two-phase)
// Poked hourly by pg_cron (run_upi_autopay_charges). Razorpay "Charge at Will"
// for UPI enforces the RBI e-mandate rule literally, so a debit is a TWO-STEP
// dance separated by ~25 hours:
//   Phase A — NOTIFY: for every plan due to deliver TOMORROW, create an order
//     carrying a `notification` object. Razorpay delivers the pre-debit alert to
//     the customer. No money moves. The charge row is left 'notified'.
//   Phase B — DEBIT: for every 'notified' charge whose 25h window has elapsed,
//     call payments/create/recurring to pull the money. Marked 'processing'.
// Both phases run every hour; each is idempotent, so a plan is notified once and
// debited once no matter how often the function is poked.
//
// It NEVER creates a delivery order itself — the order is built only when
// Razorpay confirms the debit was captured, from the razorpay-webhook. So a
// failed or blocked debit can never deliver unpaid milk.
//
// Idempotency lives in the DB: sub_upi_begin_notify claims each (plan, day) via
// a UNIQUE row; sub_upi_due_debit only returns charges whose window has elapsed.
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

// UPI AutoPay is bound by RBI's e-mandate rule: the customer must be notified at
// least 24 hours before every debit. Razorpay sends that pre-debit notification
// when the order carries a `notification` object, then auto-debits at
// `payment_after`. We aim the debit at 04:00 IST on the delivery morning — a
// couple of hours before the earliest slot (store opens 06:00) and always well
// past the 24-hour floor (this run fires ~26h earlier, around 01:30 IST the day
// before). A safety floor of now+24h30m guarantees we never ask for a debit the
// bank would reject as too soon.
function payAfterUnix(deliverDate: string): number {
  // Razorpay enforces a hard floor: the debit may only be attempted >=25h after
  // the pre-debit notification. Target 04:00 IST on the delivery morning (~26.5h
  // after the ~01:30 IST charge run), with a 25h30m safety floor so a late run
  // still produces a compliant timestamp.
  const target = Math.floor(Date.parse(`${deliverDate}T04:00:00+05:30`) / 1000);
  const floor = Math.floor(Date.now() / 1000) + 25 * 3600 + 1800;
  return Math.max(target, floor);
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
  const payAfter = payAfterUnix(deliver);
  const summary = { deliver, reconcileOnly, reconciled_ok: 0, reconciled_fail: 0,
    due_notify: 0, notified: 0, due_debit: 0, charged: 0, skipped: 0, failed: 0 };

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

    // ── Phase A: NOTIFY. Queue tomorrow's deliveries by creating a Razorpay
    // order that carries the pre-debit notification. Razorpay delivers the alert
    // to the customer; no money moves yet. The debit only becomes legal ~25h
    // later (RBI e-mandate rule), handled by Phase B on a later hourly run.
    const { val: dueN } = await rpc("sub_upi_due_list_notify", { p_deliver: deliver });
    const toNotify: Array<{ id: string }> = Array.isArray(dueN) ? dueN : [];
    summary.due_notify = toNotify.length;

    for (const p of toNotify) {
      const { val: begun } = await rpc("sub_upi_begin_notify", { p_plan: p.id, p_deliver: deliver });
      const claim = Array.isArray(begun) ? begun[0] : null;
      if (!claim || !claim.charge_id || !claim.mandate_token) { summary.skipped++; continue; }

      const amountPaise = Math.round(Number(claim.amount) * 100);
      if (!(amountPaise > 0)) { summary.skipped++; continue; }

      try {
        const oRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt: `sub_${p.id.slice(0, 8)}_${deliver}`,
            payment_capture: true,
            // The notification object is what makes Razorpay send the RBI pre-debit
            // alert and schedule the debit window. Without it the debit is rejected.
            notification: { token_id: claim.mandate_token, payment_after: payAfter },
            notes: { kind: "sub_recurring", subscription_id: p.id, deliver_date: deliver, charge_id: claim.charge_id },
          }),
        });
        const order = await oRes.json();
        if (!oRes.ok || !order?.id) {
          await rpc("sub_upi_fail_charge", { p_charge: claim.charge_id, p_reason: order?.error?.description || "order create failed" });
          summary.failed++;
          continue;
        }
        // Razorpay pins the real debit-legal time to (notification delivered + 25h)
        // and echoes it back — store that so Phase B fires as soon as it's legal.
        const rzpPayAfter = Number(order?.notification?.payment_after) || payAfter;
        await rpc("sub_upi_mark_notified", {
          p_charge: claim.charge_id,
          p_rzp_order: order.id,
          p_payment_after: new Date(rzpPayAfter * 1000).toISOString(),
        });
        summary.notified++;
      } catch (e) {
        summary.failed++;
        console.error("notify error", p.id, (e as Error).message);
      }
    }

    // ── Phase B: DEBIT. Every notified charge whose 25h window has elapsed: raise
    // the real auto-debit against the mandate. Capture is confirmed async by the
    // payment.captured webhook, which builds the delivery — never from here.
    const { val: dueD } = await rpc("sub_upi_due_debit", {});
    const toDebit: Array<{ charge_id: string; rzp_order_id: string; amount: number;
      mandate_token: string; rzp_customer_id: string | null; user_email: string | null; user_phone: string | null }>
      = Array.isArray(dueD) ? dueD : [];
    summary.due_debit = toDebit.length;

    for (const d of toDebit) {
      const amountPaise = Math.round(Number(d.amount) * 100);
      if (!(amountPaise > 0) || !d.rzp_order_id || !d.mandate_token) { summary.skipped++; continue; }

      try {
        const cRes = await fetch("https://api.razorpay.com/v1/payments/create/recurring", {
          method: "POST",
          headers: { Authorization: rzpAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: d.user_email || "customer@ngsstore.in",
            contact: d.user_phone ? String(d.user_phone) : "9999999999",
            amount: amountPaise,
            currency: "INR",
            order_id: d.rzp_order_id,
            customer_id: d.rzp_customer_id || undefined,
            token: d.mandate_token,
            recurring: "1",
            description: "NGS daily subscription",
            notes: { kind: "sub_recurring", charge_id: d.charge_id },
          }),
        });
        const charge = await cRes.json();
        if (!cRes.ok || !charge?.razorpay_payment_id) {
          const desc = String(charge?.error?.description || "");
          // "25 hours"/"not delivered" means our clock beat Razorpay's window by a
          // hair — leave the charge 'notified' and let the next hourly run retry,
          // rather than failing a day that will succeed shortly.
          if (/25 hours|not been delivered|not delivered|notification/i.test(desc)) {
            summary.skipped++;
            continue;
          }
          await rpc("sub_upi_settle_fail", { p_rzp_order: d.rzp_order_id, p_reason: desc || "recurring charge rejected" });
          summary.failed++;
          continue;
        }
        await rpc("sub_upi_mark_processing", { p_charge: d.charge_id });
        summary.charged++;
      } catch (e) {
        // Network/exception mid-debit — leave it 'notified'; next run retries.
        summary.skipped++;
        console.error("debit error", d.charge_id, (e as Error).message);
      }
    }

    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, ...summary });
  }
});
