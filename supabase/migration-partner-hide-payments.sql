-- ============================================================================
-- Partner dispatch: never surface wallet top-ups or membership payments to a
-- partner. These are payments, not deliveries.
--
-- dispatch_order already skipped is_membership/is_topup. The other assignment
-- paths relied only on status filters ('Placed'/'Packed'), which a top-up or
-- membership never reaches — but that's an implicit guarantee. This adds
-- EXPLICIT guards so a future change (or a manual DB edit) can never leak a
-- payment order into a partner's task list:
--   • get_my_task()            — the final gate the partner app polls
--   • assign_waiting_delivery() — early return for payment orders
--   • dispatch_tick()           — the driverless-delivery sweep
-- ============================================================================

-- get_my_task
CREATE OR REPLACE FUNCTION public.get_my_task()
 RETURNS TABLE(order_id uuid, code text, task_role text, state text, is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb, is_return boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code,
    case when o.picker_id = v_uid then 'picker' else 'delivery' end,
    case when o.picker_id = v_uid then o.picker_state else o.delivery_state end,
    (lower(coalesce(o.payment_method, '')) = 'cod'),
    (coalesce(o.payment_status,'') = 'paid'),
    case when lower(coalesce(o.payment_method, '')) = 'cod' then o.total else null end,
    case when o.rider_id = v_uid then o.location else null end,
    case when o.picker_id = v_uid or coalesce(o.is_return,false) then
      (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty)) from public.order_items oi where oi.order_id = o.id)
      else null end,
    coalesce(o.is_return, false)
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$
;

-- assign_waiting_delivery
CREATE OR REPLACE FUNCTION public.assign_waiting_delivery(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_uid uuid; v_status text; v_rider uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  if cfg.coverage_delivery <> 'staff' then return; end if;   -- owner-only mode
  select status, rider_id into v_status, v_rider from public.orders where id = p_order;
  if exists (select 1 from public.orders where id = p_order and (coalesce(is_topup,false) or coalesce(is_membership,false))) then return; end if;
  if v_rider is not null then return; end if;                -- already has a driver
  if v_status not in ('Placed', 'Packed') then return; end if; -- owner already delivering / done
  v_uid := public.pick_partner('delivery', p_order);
  if v_uid is not null then
    update public.orders set rider_id = v_uid, delivery_state = 'assigned',
      rider_assigned_at = now(), needs_owner = false where id = p_order;
    update public.partner_presence set active_order_id = p_order where user_id = v_uid;
    perform public._notify_partner(v_uid, 'delivery', p_order);
  end if;
end;
$function$
;

-- dispatch_tick
CREATE OR REPLACE FUNCTION public.dispatch_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; o record; v_uid uuid; v_deadline interval;
begin
  select * into cfg from public.ops_config where id = 1;
  v_deadline := make_interval(secs => cfg.assignment_timeout_seconds);

  -- Rollover: a delivery assigned but not accepted in time → penalize + re-pick.
  for o in select id, rider_id from public.orders
           where delivery_state = 'assigned' and rider_id is not null
             and rider_assigned_at < now() - v_deadline loop
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

  -- Rollover: a picking assigned but not accepted in time → penalize + re-pick.
  for o in select id, picker_id from public.orders
           where picker_state = 'assigned' and picker_id is not null
             and picker_assigned_at < now() - v_deadline loop
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

  -- Sweep: keep handing any still-driverless delivery to whoever is free now
  -- (e.g. a driver who just finished a run). Owner keeps it only if nobody's free.
  if cfg.coverage_delivery = 'staff' then
    for o in select id from public.orders
             where rider_id is null and status in ('Placed', 'Packed')
               and coalesce(accepted, true) <> false
               and coalesce(is_topup,false) = false and coalesce(is_membership,false) = false loop
      perform public.assign_waiting_delivery(o.id);
    end loop;
  end if;

  -- Sweep: hand any still-driverless RETURN pickup to whoever is free now.
  -- Returns always need a rider regardless of the delivery-coverage setting,
  -- so a return created when nobody was online gets picked up as soon as a
  -- delivery partner comes on shift.
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
end;
$function$
;
