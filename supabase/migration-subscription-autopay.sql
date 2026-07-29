-- Subscription auto-pay (pay-as-you-go from the NGS Wallet).
--
-- Until now a plan was PREPAID: the customer paid all N days up front. This adds
-- a second mode, pay_method = 'wallet_daily', where nothing is charged up front —
-- instead each day's cost is deducted from the wallet when that day's order is
-- created (one day before delivery). True UPI e-mandate autopay isn't available
-- (the card can't do RBI recurring), so the wallet IS the mandate: keep money in
-- it and the plan draws one day at a time.
--
-- Safety (never sell at a loss, never deliver unpaid):
--   * A day's order is only created AFTER its cost clears the wallet, inside one
--     transaction under the same per-user advisory lock checkout uses — so two
--     charges can't race the balance.
--   * If the wallet is short, no order is created. The plan waits (retrying each
--     cron tick) through the delivery window; once the window passes unfulfilled
--     the missed day is skipped (shifted, like a pause) so the plan still owes
--     the customer N delivered days, and no past-dated order is ever made.
--   * One "top up" nudge per dry spell (guarded by unfunded_since); after 14 days
--     dry the plan ends itself.
-- Prepaid plans are completely unchanged — every prepaid branch is identical to
-- before; only the new 'wallet_daily' branch is added.

begin;

alter table public.subscriptions
  add column if not exists unfunded_since timestamptz;

-- Return type changes void → boolean; drop first (only sub_generate_due calls it,
-- and plpgsql resolves that by name at runtime, so no CASCADE is needed).
drop function if exists public._sub_create_order(public.subscriptions, date);

-- ── Create one day's delivery order. Returns TRUE if it was created, FALSE only
-- for an auto-pay plan whose wallet couldn't cover that day. ──────────────────
create or replace function public._sub_create_order(p_plan public.subscriptions, p_deliver date)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prof public.profiles; v_order public.orders; v_code text;
  v_fee   numeric := coalesce(p_plan.daily_delivery, 0);
  v_items numeric := greatest(coalesce(p_plan.daily_total, 0) - coalesce(p_plan.daily_delivery, 0), 0);
  v_autopay boolean := p_plan.pay_method = 'wallet_daily';
  v_bal numeric;
begin
  select * into v_prof from public.profiles where id = p_plan.user_id;

  -- Auto-pay: this one day's cost must clear the wallet FIRST, under the same
  -- per-user lock the checkout uses, so nothing races the balance below cost.
  if v_autopay then
    perform pg_advisory_xact_lock(hashtextextended(p_plan.user_id::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = p_plan.user_id;
    if v_bal < coalesce(p_plan.daily_total, 0) then
      return false;   -- underfunded — caller decides (wait, then skip the day)
    end if;
  end if;

  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, member_savings, subscription_id, deliver_on, deliver_hour
  ) values (
    v_code, p_plan.user_id, v_prof.name, v_prof.phone, 'Scheduled', null, coalesce(v_prof.is_member,false),
    v_items, 0, 0, v_fee, 0, 0,
    0, 0, p_plan.daily_total, case when v_autopay then p_plan.daily_total else 0 end, 'subscription', 'paid',
    p_plan.address,
    case when p_plan.location is null then null else round((p_plan.location->>'distanceKm')::numeric, 2) end,
    p_plan.location, 0, p_plan.id, p_deliver, coalesce(p_plan.deliver_hour, 8)
  ) returning * into v_order;

  insert into public.order_items (order_id, product_id, name, icon, qty, price)
    select v_order.id, (it->>'id'), p.name, p.icon, (it->>'qty')::int, (it->>'price')::numeric
    from jsonb_array_elements(p_plan.items) it
    join public.products p on p.id = (it->>'id');

  update public.products pr set stock = greatest(0, stock - (it->>'qty')::int)
    from jsonb_array_elements(p_plan.items) it
    where pr.id = (it->>'id') and pr.stock is not null;

  -- Deduct today's cost from the wallet, atomic with the order above.
  if v_autopay then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (p_plan.user_id, -coalesce(p_plan.daily_total, 0), 'spent',
              'Daily plan ' || v_code, v_order.id, p_plan.user_id);
  end if;

  insert into public.notifications (user_id, title, body) values
    (p_plan.user_id, 'Kal ki delivery ready 🥛',
     'Subscription order ' || v_code || ' — delivery ' || to_char(p_deliver, 'DD Mon') || '. 🛵');
  return true;
end; $$;

-- ── Generate any due deliveries for one plan. ────────────────────────────────
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
