-- ════════════════════════════════════════════════════════════════════════════
-- Owner-as-fallback, role-scoped dispatch.
--
-- Model: an order has two independent tracks — picking and delivery. Each is
-- handled by an online staff partner if one is available, otherwise it falls to
-- the OWNER. The owner therefore only ever does the track(s) that no staff
-- member is covering (picker_id / rider_id NULL ⇒ owner's job).
--
-- New behaviour:
--  1. A delivery that couldn't be assigned at order time (every driver busy) is
--     handed to the first driver who becomes free — instead of being dumped on
--     the owner forever. Handled continuously (dispatch_tick, ≤30s) and instantly
--     the moment the order is packed (update trigger).
--  2. If no driver is free by the time the owner packs, the owner gets the
--     delivery step (surfaced in the admin as role-scoped buttons).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Try to hand ONE waiting delivery to an available (idle, online) driver. ──
create or replace function public.assign_waiting_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cfg public.ops_config; v_uid uuid; v_status text; v_rider uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  if cfg.coverage_delivery <> 'staff' then return; end if;   -- owner-only mode
  select status, rider_id into v_status, v_rider from public.orders where id = p_order;
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
$function$;

-- ── When an order gets packed (or its picker state moves) and still has no
--    driver, immediately try to grab a free one — so if a driver is available
--    the moment the owner taps Packed, delivery goes to him, not the owner. ──
create or replace function public.trg_dispatch_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.rider_id is null
     and new.status in ('Placed', 'Packed')
     and coalesce(new.accepted, true) <> false
     and (new.status is distinct from old.status
          or new.picker_state is distinct from old.picker_state) then
    begin perform public.assign_waiting_delivery(new.id); exception when others then null; end;
  end if;
  return new;
end;
$function$;

drop trigger if exists dispatch_on_update on public.orders;
create trigger dispatch_on_update
  after update on public.orders
  for each row execute function public.trg_dispatch_update();

-- ── dispatch_tick: existing timeout rollovers, plus a sweep that keeps handing
--    still-unassigned deliveries to whoever is now free. ──
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
               and coalesce(accepted, true) <> false loop
      perform public.assign_waiting_delivery(o.id);
    end loop;
  end if;
end;
$function$;

-- Internal functions — never callable straight from a client.
revoke execute on function public.assign_waiting_delivery(uuid) from public, anon, authenticated;
revoke execute on function public.trg_dispatch_update() from public, anon, authenticated;
revoke execute on function public.dispatch_tick() from public, anon, authenticated;
