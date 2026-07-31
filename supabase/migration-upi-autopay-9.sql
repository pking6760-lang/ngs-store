-- UPI Autopay Phase 9 — two-phase debit to satisfy RBI's 24h pre-debit rule.
--
-- Razorpay "Charge at Will" for UPI enforces the RBI e-mandate rule literally:
--   1. NOTIFY  — create an order carrying a `notification` object. Razorpay
--      delivers the pre-debit alert to the customer. NO money moves yet.
--   2. DEBIT   — only >=25h after the notification was delivered may we call
--      payments/create/recurring to actually pull the money.
--
-- So a single "charge the evening before" pass is impossible. The engine now
-- runs hourly and walks each charge through: (notified) --debit--> (processing)
-- --webhook--> (paid) --> delivery. A charge is created ~26h before its slot.
--
-- Scheduling is now driven by how many days are already IN THE PIPELINE (any
-- non-failed charge), not by how many have been DELIVERED (days_done only moves
-- on capture, ~a day later). Using days_done here would deadlock: the day before
-- a delivery has been captured, its date is still "next", so the following day
-- would never get queued.

alter table public.subscription_charges
  add column if not exists payment_after timestamptz;

-- Earliest delivery slot that has no live (non-failed) charge yet — the next day
-- to put into the pipeline. Mirrors sub_upi_next_deliver's slot maths (start_date
-- + running offset, skipping skip_dates) but keys off charges, not days_done.
create or replace function public.sub_upi_next_notify(s public.subscriptions)
returns date
language sql stable
set search_path to 'public'
as $$
  select t.d from (
    select s.start_date + g as d
    from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 5) g
  ) t
  where s.start_date is not null
    and t.d <> all (coalesce(s.skip_dates, '{}'::date[]))
    and not exists (
      select 1 from public.subscription_charges c
      where c.subscription_id = s.id and c.deliver_date = t.d and c.status <> 'failed')
  order by t.d
  limit 1;
$$;

-- Plans whose next pipeline day is p_deliver (tomorrow) and that still have room
-- under days_total. Gated by the same launch / test-phone switch as before.
create or replace function public.sub_upi_due_list_notify(p_deliver date)
returns table(id uuid)
language sql
security definer
set search_path to 'public'
as $$
  with cfg as (
    select coalesce(upi_autopay_enabled, false) as launched,
           right(regexp_replace(coalesce(upi_autopay_test_phone, ''), '\D', '', 'g'), 10) as testph
    from public.settings where id = 1
  )
  select s.id
  from public.subscriptions s, cfg
  where s.status = 'active'
    and s.pay_method = 'upi_autopay'
    and coalesce(s.mandate_status, '') = 'confirmed'
    and s.mandate_token is not null
    and (select count(*) from public.subscription_charges c
           where c.subscription_id = s.id and c.status <> 'failed') < s.days_total
    and public.sub_upi_next_notify(s) = p_deliver
    and not exists (
      select 1 from public.subscription_charges c
      where c.subscription_id = s.id and c.deliver_date = p_deliver)
    and (
      cfg.launched
      or (cfg.testph <> '' and exists (
            select 1 from public.profiles p
            where p.id = s.user_id
              and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = cfg.testph))
    );
$$;

-- Claim a delivery day for NOTIFICATION (status 'notified'). Idempotent via the
-- UNIQUE(subscription_id, deliver_date) row. Returns the token/amount the caller
-- needs to build the Razorpay order + notification.
create or replace function public.sub_upi_begin_notify(p_plan uuid, p_deliver date)
returns table(charge_id uuid, amount numeric, mandate_token text, rzp_customer_id text, user_email text, user_phone text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare s public.subscriptions; v_prof public.profiles; v_cid uuid;
begin
  select * into s from public.subscriptions where id = p_plan;
  if s.id is null or s.status <> 'active' or s.pay_method <> 'upi_autopay' then return; end if;
  if coalesce(s.mandate_status, '') <> 'confirmed' or s.mandate_token is null then return; end if;
  if (select count(*) from public.subscription_charges c
        where c.subscription_id = s.id and c.status <> 'failed') >= s.days_total then return; end if;
  if public.sub_upi_next_notify(s) is distinct from p_deliver then return; end if;
  if coalesce(s.daily_total, 0) <= 0
     or coalesce(s.daily_total, 0) > coalesce(s.mandate_max_amount, s.daily_total) then
    return;
  end if;

  select * into v_prof from public.profiles where id = s.user_id;

  insert into public.subscription_charges (subscription_id, deliver_date, amount, status)
    values (p_plan, p_deliver, s.daily_total, 'notified')
    on conflict (subscription_id, deliver_date) do nothing
    returning id into v_cid;
  if v_cid is null then return; end if;

  return query
    select v_cid, s.daily_total, s.mandate_token, v_prof.rzp_customer_id, v_prof.email, v_prof.phone;
end; $$;

-- Store the order id + when the debit becomes legal (payment_after). Keeps the
-- charge 'notified' until the debit pass fires.
create or replace function public.sub_upi_mark_notified(p_charge uuid, p_rzp_order text, p_payment_after timestamptz)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.subscription_charges
    set rzp_order_id = p_rzp_order, payment_after = p_payment_after, updated_at = now()
    where id = p_charge and status = 'notified';
$$;

-- Charges whose pre-debit window has elapsed and are ready to actually debit.
-- Only for still-active plans — a plan cancelled after notification must never
-- be debited.
create or replace function public.sub_upi_due_debit()
returns table(charge_id uuid, rzp_order_id text, amount numeric, mandate_token text,
              rzp_customer_id text, user_email text, user_phone text)
language sql
security definer
set search_path to 'public'
as $$
  select c.id, c.rzp_order_id, c.amount, s.mandate_token, p.rzp_customer_id, p.email, p.phone
  from public.subscription_charges c
  join public.subscriptions s on s.id = c.subscription_id
  join public.profiles p on p.id = s.user_id
  where c.status = 'notified'
    and c.rzp_order_id is not null
    and c.payment_after is not null
    and c.payment_after <= now()
    and s.status = 'active'
  order by c.payment_after
  limit 100;
$$;

-- Flip a notified charge into 'processing' once create/recurring is accepted, so
-- the webhook / reconcile path (which key off 'processing') takes over.
create or replace function public.sub_upi_mark_processing(p_charge uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.subscription_charges
    set status = 'processing', updated_at = now()
    where id = p_charge and status = 'notified';
$$;
