-- Auto-pay, part 2: starting a plan without prepaying, and cancelling one.

begin;

-- ── Start a plan. 'wallet_daily' charges nothing up front — it only needs one
-- day's cost in the wallet to begin; each day is drawn as its order is made. ──
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
  if v_pay not in ('wallet', 'razorpay', 'wallet_daily') then v_pay := 'wallet'; end if;
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
  v_daily := v_items + v_fee;          -- per-day charge = items + flat delivery fee
  v_amount := v_daily * v_days;

  insert into public.subscriptions (user_id, items, address, location, deliver_hour,
    days_total, daily_total, daily_delivery, amount, pay_method, status)
    values (v_uid, v_locked, p_address, p_location, v_hour,
            v_days, v_daily, v_fee, v_amount, v_pay, 'pending')
    returning * into v_plan;

  v_code := 'NGSSUB' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_subscription, subscription_id
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone,
    case when v_pay = 'razorpay' then 'Awaiting payment' else 'Subscription' end,
    v_amount, case when v_pay = 'wallet_daily' then 0 else v_amount end, v_pay,
    case when v_pay = 'wallet' then 'paid' when v_pay = 'wallet_daily' then 'autopay' else 'pending' end,
    true, v_plan.id
  ) returning * into v_order;

  if v_pay = 'wallet' then
    -- Prepaid from wallet: full amount now.
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
    -- Auto-pay: nothing up front. Just need one day's cost to begin; the first
    -- day is charged when sub_generate_due builds tomorrow's order below.
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
  end if;

  return v_order;
end; $$;

-- ── Cancel a plan.
--   Prepaid  → refund the unused days (paid up front) — explicit, as before.
--   Auto-pay → nothing was prepaid, so there's no bulk refund. Each Scheduled
--              day was charged with wallet_used set, so cancelling those orders
--              lets the existing wallet_restore trigger return exactly the
--              already-charged-but-undelivered day(s) — no double refund. ──────
create or replace function public.cancel_subscription(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions; v_consumed int; v_left int; v_refund numeric;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status in ('completed', 'cancelled') then return; end if;

  update public.products pr set stock = pr.stock + agg.qty
    from (select oi.product_id, sum(oi.qty) qty
          from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.subscription_id = p_id and o.status = 'Scheduled'
          group by oi.product_id) agg
    where pr.id = agg.product_id and pr.stock is not null;
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and status = 'Scheduled';

  -- consumed = DAILY delivery orders past Scheduled (exclude the advance-payment order)
  select count(*) into v_consumed from public.orders
    where subscription_id = p_id and not coalesce(is_subscription, false)
      and status not in ('Scheduled', 'Cancelled');
  v_left := greatest(s.days_total - v_consumed, 0);
  v_refund := v_left * s.daily_total;

  update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_id;

  -- Only prepaid plans get the bulk unused-days refund; auto-pay is handled by
  -- the per-order wallet_restore trigger above.
  if s.status = 'active' and s.pay_method <> 'wallet_daily' and v_refund > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, v_refund, 'refund',
              'Subscription cancelled — ' || v_left || ' day(s) refunded', null, s.user_id);
  end if;
end; $$;

commit;
