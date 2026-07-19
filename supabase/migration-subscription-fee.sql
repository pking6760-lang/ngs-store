-- ════════════════════════════════════════════════════════════════════════════
-- Subscription delivery fee — flat ₹10/day (admin-editable), prepaid with the
-- plan. This ₹10 covers the day's milk-round trip (and doubles as the handling
-- fee, so items added onto that same next-day delivery are not charged again).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings
  add column if not exists sub_delivery_fee numeric not null default 10;

alter table public.subscriptions
  add column if not exists daily_delivery numeric not null default 0;

-- Fold the daily delivery fee into the plan's price + records.
create or replace function public.create_subscription_order(
  p_items jsonb, p_days int, p_hour int, p_address text, p_location jsonb, p_pay text)
 returns public.orders language plpgsql security definer set search_path to 'public' as $function$
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
  if v_pay not in ('wallet', 'razorpay') then v_pay := 'wallet'; end if;
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
    case when v_pay = 'wallet' then 'Subscription' else 'Awaiting payment' end,
    v_amount, v_amount, v_pay, case when v_pay = 'wallet' then 'paid' else 'pending' end,
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
  end if;

  return v_order;
end; $function$;

-- Daily order records the delivery fee on its own line.
create or replace function public._sub_create_order(p_plan public.subscriptions, p_deliver date)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_prof public.profiles; v_order public.orders; v_code text; v_fee numeric := coalesce(p_plan.daily_delivery, 0);
begin
  select * into v_prof from public.profiles where id = p_plan.user_id;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, member_savings, subscription_id, deliver_on
  ) values (
    v_code, p_plan.user_id, v_prof.name, v_prof.phone, 'Scheduled', null, coalesce(v_prof.is_member,false),
    p_plan.daily_total - v_fee, 0, v_fee, 0, 0, 0,
    0, 0, p_plan.daily_total, 0, 'subscription', 'paid',
    p_plan.address,
    case when p_plan.location is null then null else round((p_plan.location->>'distanceKm')::numeric, 2) end,
    p_plan.location, 0, p_plan.id, p_deliver
  ) returning * into v_order;

  insert into public.order_items (order_id, product_id, name, icon, qty, price)
    select v_order.id, (it->>'id'), p.name, p.icon, (it->>'qty')::int, (it->>'price')::numeric
    from jsonb_array_elements(p_plan.items) it
    join public.products p on p.id = (it->>'id');

  update public.products pr set stock = greatest(0, stock - (it->>'qty')::int)
    from jsonb_array_elements(p_plan.items) it
    where pr.id = (it->>'id') and pr.stock is not null;

  insert into public.notifications (user_id, title, body) values
    (p_plan.user_id, 'Kal ki delivery ready 🥛',
     'Subscription order ' || v_code || ' — delivery ' || to_char(p_deliver, 'DD Mon') || '. 🛵');
end; $function$;
revoke execute on function public._sub_create_order(public.subscriptions, date) from public, anon, authenticated;
