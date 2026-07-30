-- UPI Autopay — Phase 3: the daily charge engine.
--
-- Phase 1 set up the e-mandate and stored the token; the daily generator has so
-- far REFUSED to touch upi_autopay plans (a guard in sub_generate_due). This
-- phase adds the real once-a-day bank auto-debit, with one hard safety rule:
--
--   The delivery order is created ONLY after Razorpay confirms the debit was
--   captured (via the webhook). A failed/blocked debit never delivers milk, and
--   the subscription_charges UNIQUE(subscription_id, deliver_date) makes a double
--   tick, a retry or a replayed webhook incapable of charging or delivering twice.
--
-- Flow, per plan, the evening before each delivery:
--   run_upi_autopay_charges() [cron, master-flag-gated]
--     → edge fn sub-charge-upi: for each due plan
--         sub_upi_begin_charge()  -- claims the day (status 'processing'), returns token/amount
--         create Razorpay order    -- notes {sub_id, deliver_date}
--         sub_upi_mark_order()     -- store rzp_order_id so the webhook can find it
--         POST /payments/create/recurring  -- the actual debit request
--   razorpay-webhook:
--     payment.captured → sub_upi_settle_success() → _sub_create_order() + advance
--     payment.failed   → sub_upi_settle_fail()    → skip that one day + notify
--
-- Everything here stays DORMANT until settings.upi_autopay_enabled is flipped on
-- (run_upi_autopay_charges returns immediately while it is false), so shipping
-- this changes nothing for any live customer until the ₹1 test passes.

begin;

-- ── The plan's next delivery date: the k-th non-skipped day at offset days_done.
-- Mirrors sub_generate_due's schedule maths exactly, so both engines agree. ─────
create or replace function public.sub_upi_next_deliver(s public.subscriptions)
returns date
language sql stable set search_path to 'public'
as $$
  select d from (
    select s.start_date + g as d
    from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
  ) t
  where s.start_date is not null
    and t.d <> all (coalesce(s.skip_dates, '{}'::date[]))
  order by t.d
  offset s.days_done limit 1;
$$;

-- ── Which upi_autopay plans should be debited for delivery on p_deliver. Active,
-- mandate confirmed, that date is genuinely their next delivery, and no charge
-- row exists for it yet (so a re-run never re-lists a claimed day). ─────────────
create or replace function public.sub_upi_due_list(p_deliver date)
returns table(id uuid)
language sql security definer set search_path to 'public'
as $$
  select s.id
  from public.subscriptions s
  where s.status = 'active'
    and s.pay_method = 'upi_autopay'
    and coalesce(s.mandate_status, '') = 'confirmed'
    and s.mandate_token is not null
    and s.days_done < s.days_total
    and public.sub_upi_next_deliver(s) = p_deliver
    and not exists (
      select 1 from public.subscription_charges c
      where c.subscription_id = s.id and c.deliver_date = p_deliver
    );
$$;
revoke all on function public.sub_upi_due_list(date) from public, anon, authenticated;

-- ── Claim a day for charging. Inserts the 'processing' ledger row (UNIQUE per
-- day → only one claim ever wins) and hands back what the edge function needs to
-- raise the debit. Returns nothing if the plan is ineligible or already claimed.
create or replace function public.sub_upi_begin_charge(p_plan uuid, p_deliver date)
returns table(charge_id uuid, amount numeric, mandate_token text,
              rzp_customer_id text, user_email text, user_phone text)
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions; v_prof public.profiles; v_cid uuid;
begin
  select * into s from public.subscriptions where id = p_plan;
  if s.id is null or s.status <> 'active' or s.pay_method <> 'upi_autopay' then return; end if;
  if coalesce(s.mandate_status, '') <> 'confirmed' or s.mandate_token is null then return; end if;
  if s.days_done >= s.days_total then return; end if;
  -- Re-validate the date is really this plan's next delivery (the list could be
  -- stale by the time we get here).
  if public.sub_upi_next_deliver(s) is distinct from p_deliver then return; end if;
  -- Never ask for more than the mandate's bank-enforced cap (defence in depth;
  -- the debit would be rejected anyway).
  if coalesce(s.daily_total, 0) <= 0
     or coalesce(s.daily_total, 0) > coalesce(s.mandate_max_amount, s.daily_total) then
    return;
  end if;

  select * into v_prof from public.profiles where id = s.user_id;

  insert into public.subscription_charges (subscription_id, deliver_date, amount, status)
    values (p_plan, p_deliver, s.daily_total, 'processing')
    on conflict (subscription_id, deliver_date) do nothing
    returning id into v_cid;
  if v_cid is null then return; end if;   -- another tick already claimed this day

  return query
    select v_cid, s.daily_total, s.mandate_token, v_prof.rzp_customer_id, v_prof.email, v_prof.phone;
end; $$;
revoke all on function public.sub_upi_begin_charge(uuid, date) from public, anon, authenticated;

-- ── Store the Razorpay order id on the claimed charge, BEFORE the debit is
-- raised, so a fast webhook can always find the row. ───────────────────────────
create or replace function public.sub_upi_mark_order(p_charge uuid, p_rzp_order text)
returns void
language sql security definer set search_path to 'public'
as $$
  update public.subscription_charges
    set rzp_order_id = p_rzp_order, updated_at = now()
    where id = p_charge and status = 'processing';
$$;
revoke all on function public.sub_upi_mark_order(uuid, text) from public, anon, authenticated;

-- ── Debit CAPTURED (webhook): mark paid, build the delivery, advance the plan.
-- Idempotent — a replayed capture is a no-op once the row is 'paid'. ────────────
create or replace function public.sub_upi_settle_success(p_rzp_order text, p_payment text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare c public.subscription_charges; s public.subscriptions; v_made boolean;
begin
  select * into c from public.subscription_charges where rzp_order_id = p_rzp_order for update;
  if c.id is null then return; end if;
  if c.status = 'paid' then return; end if;               -- already settled

  update public.subscription_charges
    set status = 'paid', rzp_payment_id = coalesce(p_payment, rzp_payment_id), updated_at = now()
    where id = c.id;

  select * into s from public.subscriptions where id = c.subscription_id for update;
  if s.id is null then return; end if;

  -- Build the delivery only if this is still the plan's due day and it hasn't
  -- already been delivered (guards a capture that arrives after some other path
  -- advanced the plan). _sub_create_order makes a 'paid' order for upi_autopay
  -- (no wallet touched), which is exactly what a confirmed debit means.
  if s.status = 'active'
     and s.last_delivery is distinct from c.deliver_date
     and public.sub_upi_next_deliver(s) = c.deliver_date then
    v_made := public._sub_create_order(s, c.deliver_date);
    if v_made then
      update public.subscriptions
        set days_done = days_done + 1, last_delivery = c.deliver_date, updated_at = now()
        where id = s.id;
      update public.subscriptions
        set status = 'completed', updated_at = now()
        where id = s.id and days_done >= days_total and status = 'active';
    end if;
  end if;
end; $$;
revoke all on function public.sub_upi_settle_success(text, text) from public, anon, authenticated;

-- ── Debit FAILED: record it and skip just that one day, so the plan rolls on to
-- the next date. We NEVER deliver on a failed debit. Shared core, two entry
-- points: by Razorpay order id (webhook) and by charge id (edge fn, when the
-- debit was rejected before an order id existed). ─────────────────────────────
create or replace function public._sub_upi_fail(c public.subscription_charges)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions;
begin
  if c.id is null or c.status = 'paid' then return; end if;   -- a capture already won

  update public.subscription_charges
    set status = 'failed', updated_at = now()
    where id = c.id and status <> 'paid';

  select * into s from public.subscriptions where id = c.subscription_id for update;
  if s.id is null then return; end if;

  -- Drop that delivery date (append to skip_dates), so days_done maths shifts the
  -- plan to the next day — the customer keeps their plan, just misses this day.
  if s.status = 'active'
     and not (c.deliver_date = any (coalesce(s.skip_dates, '{}'::date[]))) then
    update public.subscriptions
      set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), c.deliver_date),
          updated_at = now()
      where id = s.id;
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Autopay couldn''t go through',
       'We couldn''t auto-debit for your ' || to_char(c.deliver_date, 'DD Mon') ||
       ' delivery, so we''ve skipped only that day. Your plan continues as usual. '
       || 'Please make sure your UPI account has enough balance.');
  end if;
end; $$;
revoke all on function public._sub_upi_fail(public.subscription_charges) from public, anon, authenticated;

create or replace function public.sub_upi_settle_fail(p_rzp_order text, p_reason text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare c public.subscription_charges;
begin
  select * into c from public.subscription_charges where rzp_order_id = p_rzp_order for update;
  perform public._sub_upi_fail(c);
end; $$;
revoke all on function public.sub_upi_settle_fail(text, text) from public, anon, authenticated;

create or replace function public.sub_upi_fail_charge(p_charge uuid, p_reason text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare c public.subscription_charges;
begin
  select * into c from public.subscription_charges where id = p_charge for update;
  perform public._sub_upi_fail(c);
end; $$;
revoke all on function public.sub_upi_fail_charge(uuid, text) from public, anon, authenticated;

-- ── Cron entry: poke the charge edge function once a day, but ONLY when the
-- master flag is on. While upi_autopay_enabled is false this is a pure no-op, so
-- the daily job can be scheduled now and stays silent until launch. ────────────
create or replace function public.run_upi_autopay_charges()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_secret text; v_enabled boolean;
begin
  select coalesce(upi_autopay_enabled, false) into v_enabled from public.settings where id = 1;
  if not coalesce(v_enabled, false) then return; end if;   -- master off-switch

  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/sub-charge-upi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then null;
end; $$;

commit;
