-- ════════════════════════════════════════════════════════════════════════════
-- Show delivery date AND timing on scheduled subscription orders in the admin.
-- The delivery date already lives on orders.deliver_on; the time-of-day slot
-- lives on the subscription (deliver_hour). Copy that hour onto each daily order
-- so the admin order list/detail can show "Delivery Mon, 21 Jul · around 8 AM"
-- without an extra join.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.orders add column if not exists deliver_hour int;

-- Backfill hours for already-created subscription orders.
update public.orders o set deliver_hour = s.deliver_hour
  from public.subscriptions s
  where o.subscription_id = s.id and o.deliver_hour is null;

-- Stamp deliver_hour on every future daily order at creation time.
create or replace function public._sub_create_order(p_plan public.subscriptions, p_deliver date)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_prof public.profiles; v_order public.orders; v_code text;
begin
  select * into v_prof from public.profiles where id = p_plan.user_id;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, member_savings, subscription_id, deliver_on, deliver_hour
  ) values (
    v_code, p_plan.user_id, v_prof.name, v_prof.phone, 'Scheduled', null, coalesce(v_prof.is_member,false),
    p_plan.daily_total, 0, 0, 0, 0, 0,
    0, 0, p_plan.daily_total, 0, 'subscription', 'paid',
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

  insert into public.notifications (user_id, title, body) values
    (p_plan.user_id, 'Kal ki delivery ready 🥛',
     'Subscription order ' || v_code || ' — delivery ' || to_char(p_deliver, 'DD Mon') || '. 🛵');
end; $function$;
revoke execute on function public._sub_create_order(public.subscriptions, date) from public, anon, authenticated;

select column_name from information_schema.columns where table_name='orders' and column_name='deliver_hour';
