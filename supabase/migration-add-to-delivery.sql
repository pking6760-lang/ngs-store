-- ════════════════════════════════════════════════════════════════════════════
-- "Add to tomorrow's delivery" — ride items along with an upcoming subscription
-- delivery (the morning milk trip).
--   • add_to_delivery(items): finds the customer's nearest upcoming Scheduled
--     subscription delivery and creates a linked add-on order for that same day.
--   • Priced at the standard shelf price; delivery follows the NORMAL rule (free
--     when non-exempt items ≥ free_delivery_above, else the standard fee). NO
--     handling — the subscription's ₹10 convenience fee already covers this trip.
--   • Prepaid from the NGS Wallet (no cash), matching the subscription model.
--   • The add-on order is Scheduled + linked to the plan, so it goes live and is
--     delivered together with the milk on the delivery morning.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.add_to_delivery(p_items jsonb)
 returns public.orders language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles; v_settings public.settings;
  v_deliver date; v_plan uuid; v_addr text; v_loc jsonb;
  v_line jsonb; v_prod public.products; v_qty int; v_price numeric;
  v_items numeric := 0; v_qualify numeric := 0; v_delivery numeric := 0;
  v_total numeric; v_bal numeric; v_code text; v_order public.orders;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  select * into v_settings from public.settings where id = 1;

  -- Nearest upcoming subscription delivery (a still-scheduled daily order).
  select deliver_on, subscription_id, address, location
    into v_deliver, v_plan, v_addr, v_loc
  from public.orders
  where user_id = v_uid and subscription_id is not null and not coalesce(is_subscription, false)
    and status = 'Scheduled' and deliver_on >= (now() at time zone 'Asia/Kolkata')::date
  order by deliver_on asc limit 1;
  if v_deliver is null then raise exception 'You have no upcoming delivery to add to.'; end if;

  -- Price the add-on items (standard price) + which count toward free delivery.
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A product is no longer available.'; end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then raise exception '% is out of stock.', v_prod.name; end if;
    v_price := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_items := v_items + v_price * v_qty;
    if not coalesce(v_prod.free_delivery_exempt, false) then v_qualify := v_qualify + v_price * v_qty; end if;
  end loop;
  if v_items <= 0 then raise exception 'Your cart is empty.'; end if;

  -- Delivery: normal rule; NO handling (subscription convenience fee covers it).
  if v_qualify >= v_settings.free_delivery_above then v_delivery := 0;
  else v_delivery := coalesce(v_settings.delivery_fee, 0); end if;
  v_total := v_items + v_delivery;

  -- Prepaid from wallet (same advisory-lock key as every other wallet debit).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
  select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
  if v_bal < v_total then
    raise exception 'Your wallet has ₹% but this add-on is ₹%. Add money to your wallet to add it.',
      floor(v_bal)::text, floor(v_total)::text;
  end if;

  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned, points_redeemed,
    points_discount, total, wallet_used, payment_method, payment_status, address, distance_km,
    location, member_savings, subscription_id, deliver_on
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone, 'Scheduled', coalesce(v_prof.is_member, false),
    v_items, 0, v_delivery, 0, 0, 0, 0, 0, v_total, v_total, 'wallet', 'paid',
    v_addr, case when v_loc is null then null else round((v_loc->>'distanceKm')::numeric, 2) end,
    v_loc, 0, v_plan, v_deliver
  ) returning * into v_order;

  insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
    values (v_uid, -v_total, 'spent', 'Added to delivery ' || v_code, v_order.id, v_uid);

  insert into public.order_items (order_id, product_id, name, icon, qty, price)
    select v_order.id, (it->>'id'), p.name, p.icon, (it->>'qty')::int,
           public.bulk_unit_price(p.price, p.bulk_tiers, (it->>'qty')::int)
    from jsonb_array_elements(p_items) it join public.products p on p.id = (it->>'id');

  update public.products pr set stock = greatest(0, stock - agg.qty)
    from (select (it->>'id') id, sum((it->>'qty')::int) qty
          from jsonb_array_elements(p_items) it group by 1) agg
    where pr.id = agg.id and pr.stock is not null;

  return v_order;
end; $function$;
revoke execute on function public.add_to_delivery(jsonb) from public, anon;
grant execute on function public.add_to_delivery(jsonb) to authenticated;
