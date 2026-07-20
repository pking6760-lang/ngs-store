-- ════════════════════════════════════════════════════════════════════════════
-- Online payment for "add to delivery" add-ons.
--   • mark_order_paid: when a paid order is future-dated (deliver_on > today), it
--     becomes 'Scheduled' (delivered on its day with the milk), not 'Placed' now.
--     Only add-on / subscription orders carry a future deliver_on, so normal
--     orders are unaffected.
--   • add_to_delivery(items, pay): 'wallet' (instant, as before) or 'razorpay'
--     (creates an Awaiting-payment add-on; the customer pays via the same UPI QR;
--     mark_order_paid then makes it Scheduled + reserves stock).
-- ════════════════════════════════════════════════════════════════════════════

-- ── mark_order_paid: future-dated paid orders → Scheduled ────────────────────
create or replace function public.mark_order_paid(p_order uuid, p_payment_id text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_order public.orders; v_line record;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.payment_status = 'paid' then return; end if;
  if v_order.status = 'Cancelled' then return; end if;

  if coalesce(v_order.is_membership, false) then
    perform public._activate_membership(v_order.user_id, coalesce(v_order.membership_days, 30));
    update public.orders set payment_status = 'paid', status = 'Membership',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    return;
  end if;

  if coalesce(v_order.is_topup, false) then
    if not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'topup') then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_order.user_id, v_order.total, 'topup', 'Added to wallet', p_order, v_order.user_id);
    end if;
    update public.orders set payment_status = 'paid', status = 'Wallet top-up',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    return;
  end if;

  if coalesce(v_order.is_subscription, false) then
    update public.orders set payment_status = 'paid', status = 'Subscription',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_order.subscription_id and status = 'pending';
    perform public.sub_generate_due(v_order.subscription_id);
    return;
  end if;

  -- Normal fulfilment order. A future deliver_on (add-on riding an upcoming
  -- delivery) becomes 'Scheduled' and goes live on its day; otherwise 'Placed'.
  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'Awaiting payment' then
                            case when deliver_on is not null and deliver_on > (now() at time zone 'Asia/Kolkata')::date
                                 then 'Scheduled' else 'Placed' end
                          else status end,
    razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
  where id = p_order;

  for v_line in select product_id, qty from public.order_items where order_id = p_order loop
    update public.products set stock = greatest(0, stock - v_line.qty)
      where id = v_line.product_id and stock is not null;
  end loop;

  if coalesce(v_order.wallet_used, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'spent') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, -v_order.wallet_used, 'spent', 'Used on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.points_redeemed, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Redeemed on%') then
    update public.profiles set points = greatest(0, points - v_order.points_redeemed) where id = v_order.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, -v_order.points_redeemed, 'Redeemed on ' || v_order.human_code);
  end if;

  if v_order.points_earned > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Earned%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.points_earned, 'Earned on ' || v_order.human_code);
    update public.profiles set points = points + v_order.points_earned where id = v_order.user_id;
  end if;

  if coalesce(v_order.member_bonus_points, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Prime bonus%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.member_bonus_points, 'Prime bonus on ' || v_order.human_code);
    update public.profiles set points = points + v_order.member_bonus_points where id = v_order.user_id;
  end if;
  if coalesce(v_order.member_bonus_wallet, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'reward' and note like 'Prime bonus%') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, v_order.member_bonus_wallet, 'reward', 'Prime bonus on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.membership_days, 0) > 0 then
    perform public._activate_membership(v_order.user_id, v_order.membership_days);
  end if;

  if not coalesce(v_order.is_return, false) then
    update public.profiles set
      order_count = coalesce(order_count, 0) + 1,
      member_order_count = case when coalesce(v_order.member, false) then coalesce(member_order_count, 0) + 1 else member_order_count end
    where id = v_order.user_id;
  end if;
end;
$function$;

-- ── add_to_delivery(items, pay) ──────────────────────────────────────────────
drop function if exists public.add_to_delivery(jsonb);   -- replace the wallet-only overload
create or replace function public.add_to_delivery(p_items jsonb, p_pay text default 'wallet')
 returns public.orders language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles; v_settings public.settings;
  v_deliver date; v_plan uuid; v_addr text; v_loc jsonb;
  v_line jsonb; v_prod public.products; v_qty int; v_price numeric;
  v_items numeric := 0; v_qualify numeric := 0; v_delivery numeric := 0;
  v_total numeric; v_bal numeric; v_code text; v_order public.orders;
  v_pay text := lower(coalesce(p_pay, 'wallet'));
  v_online boolean;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  if v_pay not in ('wallet', 'razorpay') then v_pay := 'wallet'; end if;
  v_online := v_pay = 'razorpay';
  select * into v_prof from public.profiles where id = v_uid;
  select * into v_settings from public.settings where id = 1;

  select deliver_on, subscription_id, address, location
    into v_deliver, v_plan, v_addr, v_loc
  from public.orders
  where user_id = v_uid and subscription_id is not null and not coalesce(is_subscription, false)
    and status = 'Scheduled' and deliver_on >= (now() at time zone 'Asia/Kolkata')::date
  order by deliver_on asc limit 1;
  if v_deliver is null then raise exception 'You have no upcoming delivery to add to.'; end if;

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

  if v_qualify >= v_settings.free_delivery_above then v_delivery := 0;
  else v_delivery := coalesce(v_settings.delivery_fee, 0); end if;
  v_total := v_items + v_delivery;

  if not v_online then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_total then
      raise exception 'Your wallet has ₹% but this add-on is ₹%. Add money to your wallet to add it.',
        floor(v_bal)::text, floor(v_total)::text;
    end if;
  end if;

  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned, points_redeemed,
    points_discount, total, wallet_used, payment_method, payment_status, address, distance_km,
    location, member_savings, subscription_id, deliver_on
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone,
    case when v_online then 'Awaiting payment' else 'Scheduled' end,
    coalesce(v_prof.is_member, false),
    v_items, 0, v_delivery, 0, 0, 0, 0, 0, v_total,
    case when v_online then 0 else v_total end,
    v_pay, case when v_online then 'pending' else 'paid' end,
    v_addr, case when v_loc is null then null else round((v_loc->>'distanceKm')::numeric, 2) end,
    v_loc, 0, v_plan, v_deliver
  ) returning * into v_order;

  -- Items always (the razorpay confirm reads them to decrement stock).
  insert into public.order_items (order_id, product_id, name, icon, qty, price)
    select v_order.id, (it->>'id'), p.name, p.icon, (it->>'qty')::int,
           public.bulk_unit_price(p.price, p.bulk_tiers, (it->>'qty')::int)
    from jsonb_array_elements(p_items) it join public.products p on p.id = (it->>'id');

  -- Wallet: debit + reserve stock NOW. Online: mark_order_paid does both on pay.
  if not v_online then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_total, 'spent', 'Added to delivery ' || v_code, v_order.id, v_uid);
    update public.products pr set stock = greatest(0, stock - agg.qty)
      from (select (it->>'id') id, sum((it->>'qty')::int) qty
            from jsonb_array_elements(p_items) it group by 1) agg
      where pr.id = agg.id and pr.stock is not null;
  end if;

  return v_order;
end; $function$;
revoke execute on function public.add_to_delivery(jsonb, text) from public, anon;
grant execute on function public.add_to_delivery(jsonb, text) to authenticated;
