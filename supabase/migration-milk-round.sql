-- ════════════════════════════════════════════════════════════════════════════
-- Subscription "milk round": at the delivery hour, all of that morning's milk
-- orders are handed to ONE driver as a single route (or fall to the owner if no
-- driver is online). The driver is paid 70% of the ₹ handling per stop; the shop
-- keeps the other 30% plus the item margin.
--
--   1. _sub_create_order — restore the item/handling split (item_total = items,
--      handling = the daily convenience fee) that a prior migration flattened.
--      This is also what the 70%-of-handling driver pay is based on.
--   2. _pick_milk_driver / dispatch_milk_round — batch-assign the round.
--   3. sub_activate_due — flip due orders, then dispatch the round as a batch.
--   4. trg_dispatch_update / dispatch_tick — never scatter or individually
--      re-pick a subscription order (the round owns them).
--   5. partner_mark_delivered — milk stops pay 70% of handling, not the normal
--      distance-based rate.
--   6. get_my_round — the driver app's list of today's milk stops.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ── Correct item/handling split on each daily order ───────────────────────
create or replace function public._sub_create_order(p_plan public.subscriptions, p_deliver date)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_prof public.profiles; v_order public.orders; v_code text;
        v_fee numeric := coalesce(p_plan.daily_delivery, 0);
        v_items numeric := greatest(coalesce(p_plan.daily_total, 0) - coalesce(p_plan.daily_delivery, 0), 0);
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
    v_items, 0, 0, v_fee, 0, 0,
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

-- Backfill: any daily order created by the flattened version (handling 0 but the
-- plan charged a fee) → move the fee out of item_total into handling.
update public.orders o set
  handling = coalesce(s.daily_delivery, 0),
  item_total = greatest(coalesce(o.total,0) - coalesce(s.daily_delivery,0), 0)
from public.subscriptions s
where o.subscription_id = s.id and not coalesce(o.is_subscription,false)
  and coalesce(o.handling,0) = 0 and coalesce(s.daily_delivery,0) > 0
  and o.status in ('Scheduled','Placed');

-- 2 ── Pick one driver for the whole round ───────────────────────────────────
-- A scheduled milk round isn't on-demand: ignore slots and the single active-
-- order lock — just the longest-online approved delivery partner.
create or replace function public._pick_milk_driver()
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid;
begin
  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  where pa.status = 'approved' and pa.role in ('delivery','both')
    and pr.is_online = true
  order by pr.went_online_at asc nulls last
  limit 1;
  return v_uid;
end; $function$;
revoke execute on function public._pick_milk_driver() from public, anon, authenticated;

-- Hand every just-activated milk order for today to one driver (or the owner).
create or replace function public.dispatch_milk_round()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_driver uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_first uuid; v_n int;
begin
  select * into cfg from public.ops_config where id = 1;
  select count(*) into v_n from public.orders
    where subscription_id is not null and not coalesce(is_subscription,false)
      and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
      and deliver_on = v_today;
  if coalesce(v_n,0) = 0 then return; end if;
  select id into v_first from public.orders
    where subscription_id is not null and not coalesce(is_subscription,false)
      and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
      and deliver_on = v_today
    order by human_code limit 1;

  if cfg.coverage_delivery = 'staff' then
    v_driver := public._pick_milk_driver();
  end if;

  if v_driver is not null then
    update public.orders
      set rider_id = v_driver, delivery_state = 'assigned', rider_assigned_at = now(), needs_owner = false
      where subscription_id is not null and not coalesce(is_subscription,false)
        and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
        and deliver_on = v_today;
    -- One push to the driver; the app then loads the whole round.
    begin perform public._notify_partner(v_driver, 'delivery', v_first); exception when others then null; end;
  else
    -- No driver online → the round is the owner's to deliver.
    update public.orders set needs_owner = true
      where subscription_id is not null and not coalesce(is_subscription,false)
        and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
        and deliver_on = v_today;
  end if;
end; $function$;
revoke execute on function public.dispatch_milk_round() from public, anon, authenticated;

-- 3 ── Flip due orders, then dispatch them as one round ───────────────────────
create or replace function public.sub_activate_due()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_hour  int  := extract(hour from (now() at time zone 'Asia/Kolkata'))::int;
        v_n int;
begin
  with due as (
    update public.orders o set status = 'Placed'
    from public.subscriptions s
    where o.subscription_id = s.id
      and o.status = 'Scheduled'
      and o.deliver_on <= v_today
      and v_hour >= coalesce(s.deliver_hour, 8)
    returning o.id
  )
  select count(*) into v_n from due;
  if coalesce(v_n,0) > 0 then
    perform public.dispatch_milk_round();
  end if;
  return coalesce(v_n, 0);
end; $function$;
revoke execute on function public.sub_activate_due() from public, anon, authenticated;

-- 4 ── Keep individual dispatch away from subscription orders ─────────────────
create or replace function public.trg_dispatch_update()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- Subscription daily orders are delivered as a batch milk round, never
  -- dispatched or swept one-by-one.
  if new.subscription_id is not null and not coalesce(new.is_subscription,false) then
    return new;
  end if;
  -- Online payment: Awaiting payment → Placed dispatches the order.
  if (old.status = 'Awaiting payment' or old.status = 'Scheduled') and new.status = 'Placed' then
    begin perform public.dispatch_order(new.id); exception when others then null; end;
    return new;
  end if;
  if new.rider_id is null
     and new.status in ('Placed', 'Packed')
     and coalesce(new.accepted, true) <> false
     and (new.status is distinct from old.status
          or new.picker_state is distinct from old.picker_state) then
    begin perform public.assign_waiting_delivery(new.id); exception when others then null; end;
  end if;
  return new;
end; $function$;

-- 5 ── Milk-round pay: 70% of the handling per stop ───────────────────────────
create or replace function public.partner_mark_delivered(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean;
        v_dist numeric; v_member boolean; v_base numeric; v_upd int;
        v_is_milk boolean; v_handling numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km, coalesce(member, false),
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid'),
         (subscription_id is not null and not coalesce(is_subscription,false)), coalesce(handling,0)
    into v_rid, v_total, v_dist, v_member, v_cash, v_is_milk, v_handling
    from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  perform public._ensure_pool(p_order);
  if v_is_milk then
    -- Milk round: driver keeps 70% of the handling collected on this stop.
    v_earn := round(0.70 * v_handling, 2);
  else
    v_base := case when v_member then coalesce(cfg.rider_member_base, cfg.rider_base) else cfg.rider_base end;
    v_earn := round(
        v_base
      + greatest(coalesce(v_dist,0) - cfg.rider_free_km, 0) * cfg.rider_per_km
      + case when coalesce(cfg.surge_on,false) then cfg.peak_bonus else 0 end, 2);
  end if;
  update public.orders
     set delivery_state = 'delivered', delivered_at = now(), status = 'Delivered',
         payment_status = case when v_cash then 'paid' else payment_status end
   where id = p_order and delivery_state <> 'delivered';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  insert into public.order_economics (order_id, rider_earning)
    values (p_order, case when v_rid is not null then v_earn else 0 end)
    on conflict (order_id) do update set rider_earning = excluded.rider_earning, updated_at = now();
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, case when v_is_milk then 'Milk round' else 'Delivery' end, auth.uid());
    if v_cash then
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $function$;

-- 6 ── The driver app's milk round for today ─────────────────────────────────
create or replace function public.get_my_round()
 returns table(order_id uuid, code text, state text, location jsonb, address text,
               customer text, items jsonb, earning numeric, total numeric)
 language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code, o.delivery_state, o.location, o.address, o.customer_name,
    (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty))
       from public.order_items oi where oi.order_id = o.id),
    round(0.70 * coalesce(o.handling,0), 2), o.total
  from public.orders o
  where o.rider_id = v_uid
    and o.subscription_id is not null and not coalesce(o.is_subscription,false)
    and o.delivery_state not in ('delivered','returned')
    and o.deliver_on = v_today
  order by o.distance_km asc nulls last, o.human_code;
end; $function$;
revoke execute on function public.get_my_round() from public, anon;
grant execute on function public.get_my_round() to authenticated;

-- Exclude subscription orders from the individual rollover + sweep in dispatch_tick.
create or replace function public.dispatch_tick()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; o record; v_uid uuid; v_deadline interval;
begin
  select * into cfg from public.ops_config where id = 1;
  v_deadline := make_interval(secs => cfg.assignment_timeout_seconds);

  for o in select id, rider_id from public.orders
           where delivery_state = 'assigned' and rider_id is not null
             and rider_assigned_at < now() - v_deadline
             and not (subscription_id is not null and not coalesce(is_subscription,false)) loop
    perform public.partner_penalize(o.rider_id, 'dodged_order', o.id, null);
    update public.partner_presence set active_order_id = null where user_id = o.rider_id and active_order_id = o.id;
    update public.orders set dispatch_tried = array_append(dispatch_tried, o.rider_id),
       rider_id = null, delivery_state = 'unassigned', rider_assigned_at = null where id = o.id;
    v_uid := public.pick_partner('delivery', o.id);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = o.id;
      update public.partner_presence set active_order_id = o.id where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', o.id);
    else
      update public.orders set needs_owner = true where id = o.id;
    end if;
  end loop;

  for o in select id, picker_id from public.orders
           where picker_state = 'assigned' and picker_id is not null
             and picker_assigned_at < now() - v_deadline
             and not (subscription_id is not null and not coalesce(is_subscription,false)) loop
    perform public.partner_penalize(o.picker_id, 'dodged_order', o.id, null);
    update public.partner_presence set active_order_id = null where user_id = o.picker_id and active_order_id = o.id;
    update public.orders set dispatch_tried = array_append(dispatch_tried, o.picker_id),
       picker_id = null, picker_state = 'unassigned', picker_assigned_at = null where id = o.id;
    v_uid := public.pick_partner('picker', o.id);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = o.id;
      update public.partner_presence set active_order_id = o.id where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', o.id);
    else
      update public.orders set needs_owner = true where id = o.id;
    end if;
  end loop;

  if cfg.coverage_delivery = 'staff' then
    for o in select id from public.orders
             where rider_id is null and status in ('Placed', 'Packed')
               and coalesce(accepted, true) <> false
               and coalesce(is_topup,false) = false and coalesce(is_membership,false) = false
               and not (subscription_id is not null and not coalesce(is_subscription,false)) loop
      perform public.assign_waiting_delivery(o.id);
    end loop;
  end if;

  for o in select id from public.orders
           where is_return and rider_id is null and status = 'Return requested' loop
    v_uid := public.pick_partner('delivery', o.id);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = o.id;
      update public.partner_presence set active_order_id = o.id where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', o.id);
    else
      update public.orders set needs_owner = true where id = o.id;
    end if;
  end loop;
end; $function$;

select 'milk-round migration applied' as status;
