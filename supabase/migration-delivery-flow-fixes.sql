-- (a)+(b) dispatch_order: never assign/ring a partner for an unpaid online order;
-- flag the owner immediately when staff delivery has nobody available.
CREATE OR REPLACE FUNCTION public.dispatch_order(p_order uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_uid uuid; v_is_return boolean; v_is_mem boolean; v_is_top boolean; v_status text;
begin
  select is_return, is_membership, is_topup, status
    into v_is_return, v_is_mem, v_is_top, v_status
    from public.orders where id = p_order;
  if coalesce(v_is_mem,false) or coalesce(v_is_top,false) then return; end if;
  -- Online orders are inserted 'Awaiting payment'. Don't assign or ring a partner
  -- until the customer actually pays; payment flips status to 'Placed' and the
  -- update trigger re-runs this dispatch.
  if v_status = 'Awaiting payment' then return; end if;
  select * into cfg from public.ops_config where id = 1;
  if not coalesce(v_is_return,false)
     and cfg.coverage_picking = 'staff'
     and (select picker_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('picker', p_order);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', p_order);
    end if;
  end if;
  if (coalesce(v_is_return,false) or cfg.coverage_delivery = 'staff')
     and (select rider_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('delivery', p_order);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now(), needs_owner = false where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', p_order);
    elsif cfg.coverage_delivery = 'staff' then
      -- Staff delivery but nobody free right now → tell the owner immediately
      -- rather than waiting for the next 30s dispatch tick.
      update public.orders set needs_owner = true where id = p_order and delivery_state = 'unassigned';
    end if;
  end if;
end; $function$;

-- (a) On payment completion (held 'Awaiting payment' -> 'Placed'), run the full
-- initial dispatch (picker + delivery), not just the delivery re-assign.
CREATE OR REPLACE FUNCTION public.trg_dispatch_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if old.status = 'Awaiting payment' and new.status = 'Placed' then
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

-- (c) Close the double-assignment race: lock the chosen partner's presence row
-- and skip any partner another concurrent dispatch is already grabbing.
CREATE OR REPLACE FUNCTION public.pick_partner(p_role text, p_order uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_total numeric; v_cod boolean; v_hour int; v_date date; v_uid uuid; v_tried uuid[];
begin
  select * into cfg from public.ops_config where id = 1;
  select total, lower(coalesce(payment_method, '')) = 'cod', coalesce(dispatch_tried,'{}')
    into v_total, v_cod, v_tried from public.orders where id = p_order;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;
  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl on sl.partner_id = pa.user_id
       and sl.slot_date = v_date and sl.start_hour = v_hour and sl.role = p_role and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role = p_role
    and pr.is_online = true and pr.active_order_id is null
    and pa.user_id <> all(v_tried)
    and (p_role <> 'delivery' or not v_cod or (public.partner_cash_in_hand(pa.user_id) + v_total) <= cfg.rider_cash_cap)
  order by pr.went_online_at asc nulls last
  limit 1
  for update of pr skip locked;
  return v_uid;
end; $function$;

-- Let a customer attach their exact location to an order they already placed
-- (e.g. they checked out with only a typed address), so live tracking + the map
-- can work. Owner-scoped and only while the order is still in flight.
CREATE OR REPLACE FUNCTION public.set_order_location(p_order uuid, p_location jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.orders
    set location = p_location
    where id = p_order
      and user_id = auth.uid()
      and status in ('Placed','Packed','Out for delivery');
  if not found then raise exception 'Order not found or no longer editable'; end if;
end; $function$;
grant execute on function public.set_order_location(uuid, jsonb) to authenticated;
