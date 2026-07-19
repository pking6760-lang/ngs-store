-- ════════════════════════════════════════════════════════════════════════════
-- The subscription's flat ₹10/day is a HANDLING charge (covers the morning
-- milk-round trip). It is NOT a delivery fee — a milk-only plan pays just this
-- ₹10 and no delivery fee. Delivery only applies when the customer later ADDS
-- other items onto that same next-day trip, and then it follows the normal rules
-- (free over ₹199 of non-exempt items, else the standard delivery fee) with NO
-- second handling charge (this ₹10 already covered it).
-- ════════════════════════════════════════════════════════════════════════════
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
    p_plan.daily_total - v_fee, 0, 0, v_fee, 0, 0,   -- delivery_fee 0, handling = the ₹10
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
