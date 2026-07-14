create or replace function public.dispatch_tick()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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
               and coalesce(accepted, true) <> false loop
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
$function$;
