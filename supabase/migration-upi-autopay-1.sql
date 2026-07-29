-- UPI Autopay — Phase 1: mandate setup + storage. Charges NOBODY on its own.
--
-- This lays the ground for real UPI Autopay (daily bank auto-debit via a Razorpay
-- e-mandate). Phase 1 only: create the pending plan, let the customer approve a
-- mandate, and store the returned token. The daily charge engine is Phase 3, so a
-- guard keeps sub_generate_due from touching upi_autopay plans for now.

begin;

-- ── Storage ──────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists rzp_customer_id text;      -- Razorpay customer, reused across mandates

alter table public.subscriptions
  add column if not exists mandate_token      text,    -- the approved e-mandate token
  add column if not exists mandate_status      text,   -- null|'pending'|'confirmed'|'cancelled'|'rejected'
  add column if not exists mandate_max_amount  numeric; -- bank-enforced per-debit cap (rupees)

-- Feature flag: real UPI Autopay stays HIDDEN in the app until the daily charge
-- engine (Phase 3) is live, so no customer can approve a mandate that wouldn't
-- yet deliver. Flipped on for the Phase 2 test, then for launch.
alter table public.settings
  add column if not exists upi_autopay_enabled boolean not null default false;

-- The once-only charge ledger — one row per (plan, delivery date). The UNIQUE
-- constraint is the heart of "never double-charge": a retry, double cron tick or
-- replayed webhook can't insert a second row for the same day. (Used from Phase 3.)
create table if not exists public.subscription_charges (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  deliver_date    date not null,
  amount          numeric not null,
  rzp_order_id    text,
  rzp_payment_id  text,
  status          text not null default 'pending',   -- 'pending'|'paid'|'failed'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (subscription_id, deliver_date)
);
alter table public.subscription_charges enable row level security;
drop policy if exists sc_owner_read on public.subscription_charges;
create policy sc_owner_read on public.subscription_charges for select
  using (exists (select 1 from public.subscriptions s
                 where s.id = subscription_id and s.user_id = auth.uid()));
-- writes are server-only (service role bypasses RLS); no insert/update policy for
-- anon/authenticated, so a customer can never fabricate a "paid" day.

-- ── Start-plan RPC: add the 'upi_autopay' path (pending until the mandate is
-- approved; nothing is charged here). ────────────────────────────────────────
create or replace function public.create_subscription_order(p_items jsonb, p_days integer, p_hour integer, p_address text, p_location jsonb, p_pay text)
returns public.orders
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles;
  v_line jsonb; v_prod public.products; v_qty int; v_price numeric;
  v_locked jsonb := '[]'::jsonb; v_items numeric := 0; v_fee numeric; v_daily numeric; v_amount numeric;
  v_days int := greatest(1, least(coalesce(p_days, 7), 30));
  v_hour int := greatest(0, least(coalesce(p_hour, 8), 23));
  v_pay text := lower(coalesce(p_pay, 'wallet'));
  v_plan public.subscriptions;
  v_order public.orders;
  v_code text;
  v_bal numeric;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Choose at least one item.'; end if;
  if v_pay not in ('wallet', 'razorpay', 'wallet_daily', 'upi_autopay') then v_pay := 'wallet'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  v_fee := coalesce((select sub_delivery_fee from public.settings where id = 1), 10);

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A chosen item is no longer available.'; end if;
    v_price := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_locked := v_locked || jsonb_build_object('id', v_prod.id, 'qty', v_qty, 'price', v_price);
    v_items := v_items + v_price * v_qty;
  end loop;
  if v_items <= 0 then raise exception 'Choose at least one item.'; end if;
  v_daily := v_items + v_fee;
  v_amount := v_daily * v_days;

  insert into public.subscriptions (user_id, items, address, location, deliver_hour,
    days_total, daily_total, daily_delivery, amount, pay_method, status,
    mandate_status, mandate_max_amount)
    values (v_uid, v_locked, p_address, p_location, v_hour,
            v_days, v_daily, v_fee, v_amount, v_pay, 'pending',
            case when v_pay = 'upi_autopay' then 'pending' else null end,
            -- Bank cap per debit: one day's cost + ~50% headroom (a price rise or
            -- an added item still clears, nothing wild can). Rounded to ₹10.
            case when v_pay = 'upi_autopay' then ceil(v_daily * 1.5 / 10) * 10 else null end)
    returning * into v_plan;

  v_code := 'NGSSUB' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_subscription, subscription_id
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone,
    case when v_pay in ('razorpay', 'upi_autopay') then 'Awaiting payment' else 'Subscription' end,
    v_amount,
    case when v_pay = 'wallet_daily' then 0
         when v_pay = 'upi_autopay' then v_daily   -- the mandate authorises on one day's amount
         else v_amount end,
    v_pay,
    case when v_pay = 'wallet' then 'paid' when v_pay = 'wallet_daily' then 'autopay' else 'pending' end,
    true, v_plan.id
  ) returning * into v_order;

  if v_pay = 'wallet' then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_amount then
      raise exception 'Your wallet has ₹% but the plan costs ₹%. Add money or pay online.',
        floor(v_bal)::text, floor(v_amount)::text;
    end if;
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_amount, 'spent', 'Subscription plan ' || v_code, v_order.id, v_uid);
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_plan.id;
    perform public.sub_generate_due(v_plan.id);

  elsif v_pay = 'wallet_daily' then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_daily then
      raise exception 'Add at least ₹% to your wallet to start daily auto-pay (one day''s cost). It has ₹%.',
        floor(v_daily)::text, floor(v_bal)::text;
    end if;
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_plan.id;
    perform public.sub_generate_due(v_plan.id);

  -- 'upi_autopay': leave the plan PENDING and unpaid. The edge function creates
  -- the Razorpay mandate order; the plan activates only when the webhook confirms
  -- the customer approved it. 'razorpay' (prepay online) also returns here unpaid.
  end if;

  return v_order;
end; $$;

-- ── Confirm a mandate (called only by the webhook, service-role). Stores the
-- token and activates the plan. Idempotent. Daily charging is added in Phase 3. ─
create or replace function public.confirm_upi_mandate(p_order_dbid uuid, p_payment_id text, p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_sub uuid;
begin
  select subscription_id into v_sub from public.orders where id = p_order_dbid;
  if v_sub is null then return; end if;

  update public.orders
    set payment_status = 'paid', status = 'Subscription', razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
    where id = p_order_dbid and payment_status <> 'paid';

  update public.subscriptions
    set mandate_token = coalesce(p_token, mandate_token),
        mandate_status = 'confirmed',
        status = case when status = 'pending' then 'active' else status end,
        start_date = coalesce(start_date, (now() at time zone 'Asia/Kolkata')::date + 1),
        updated_at = now()
    where id = v_sub and coalesce(mandate_status, '') <> 'confirmed';
end; $$;

revoke all on function public.confirm_upi_mandate(uuid, text, text) from public;
-- service role bypasses grants; deny anon/authenticated explicitly.

-- Guard: keep the daily generator away from upi_autopay plans until Phase 3
-- adds the real charge engine (else an activated mandate plan would create
-- unpaid delivery orders through the prepaid branch).
create or replace function public.sub_generate_due(p_plan uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  s public.subscriptions;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_deliver date; v_made boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_plan::text, 4242));
  for i in 1..60 loop
    select * into s from public.subscriptions where id = p_plan;
    if s.id is null or s.status <> 'active' then return; end if;
    if s.pay_method = 'upi_autopay' then return; end if;  -- charging is Phase 3

    -- Auto-pay plan left dry for a fortnight → end it (bounds the retry loop).
    if s.pay_method = 'wallet_daily' and s.unfunded_since is not null
       and s.unfunded_since < now() - interval '14 days' then
      update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_plan;
      insert into public.notifications (user_id, title, body) values
        (s.user_id, 'Daily plan ended',
         'Your daily plan was paused for 14 days with an empty wallet, so we''ve ended it. Re-subscribe anytime.');
      return;
    end if;

    if s.days_done >= s.days_total then
      update public.subscriptions set status = 'completed', updated_at = now() where id = p_plan;
      return;
    end if;

    -- k-th non-skipped delivery date (skip days push everything later).
    select d into v_deliver from (
      select s.start_date + g as d
      from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
    ) t
    where t.d <> all (coalesce(s.skip_dates, '{}'::date[]))
    order by t.d offset s.days_done limit 1;
    exit when v_deliver is null;
    exit when v_today < v_deliver - 1;                 -- not due yet (future)

    if s.pay_method = 'wallet_daily' then
      -- Auto-pay: the window has passed unfulfilled → drop that day (shift the
      -- plan on, like a pause), never build a past-dated order.
      if v_today > v_deliver then
        update public.subscriptions
          set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), v_deliver), updated_at = now()
          where id = p_plan;
        continue;
      end if;
      v_made := public._sub_create_order(s, v_deliver);
      if v_made then
        update public.subscriptions
          set days_done = days_done + 1, last_delivery = v_deliver, unfunded_since = null, updated_at = now()
          where id = p_plan;
      else
        -- Short right now, still inside the window → wait for a top-up; nudge once.
        if s.unfunded_since is null then
          update public.subscriptions set unfunded_since = now(), updated_at = now() where id = p_plan;
          insert into public.notifications (user_id, title, body) values
            (s.user_id, 'Top up to keep your milk 🥛',
             'Your NGS Wallet is short for the next delivery (₹' || floor(coalesce(s.daily_total,0))::text
             || '/day). Add money to keep your daily plan going.');
        end if;
        exit;
      end if;
    else
      -- Prepaid: unchanged — always create, always advance.
      perform public._sub_create_order(s, v_deliver);
      update public.subscriptions
        set days_done = days_done + 1, last_delivery = v_deliver, updated_at = now()
        where id = p_plan;
    end if;
  end loop;
  update public.subscriptions set status = 'completed', updated_at = now()
    where id = p_plan and days_done >= days_total and status = 'active';
end; $$;

commit;
