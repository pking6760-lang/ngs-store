-- partner_pass: a partner explicitly declines an order they were just assigned
-- (before accepting it). Mirrors the timeout-rollover branch of dispatch_tick
-- but fires instantly and applies NO penalty (an honest, quick pass frees the
-- order faster than silently ghosting it). Releases the order from this partner,
-- adds them to dispatch_tried so they aren't re-picked, then hands it to the
-- next nearest free partner — or flags needs_owner (admin) if none are free.
create or replace function public.partner_pass(p_order uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_role text; v_next uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;

  select case when picker_id = v_uid then 'picker'
              when rider_id  = v_uid then 'delivery' else null end
    into v_role
  from public.orders where id = p_order;
  if v_role is null then raise exception 'This order is not assigned to you.'; end if;

  if v_role = 'delivery' then
    update public.partner_presence set active_order_id = null
      where user_id = v_uid and active_order_id = p_order;
    update public.orders
       set dispatch_tried = array_append(dispatch_tried, v_uid),
           rider_id = null, delivery_state = 'unassigned', rider_assigned_at = null
     where id = p_order and rider_id = v_uid and delivery_state = 'assigned';
    if not found then raise exception 'Too late — this order already moved on.'; end if;

    v_next := public.pick_partner('delivery', p_order);
    if v_next is not null then
      update public.orders set rider_id = v_next, delivery_state = 'assigned',
             rider_assigned_at = now(), needs_owner = false where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_next;
      perform public._notify_partner(v_next, 'delivery', p_order);
    else
      update public.orders set needs_owner = true where id = p_order;
    end if;
  else
    update public.partner_presence set active_order_id = null
      where user_id = v_uid and active_order_id = p_order;
    update public.orders
       set dispatch_tried = array_append(dispatch_tried, v_uid),
           picker_id = null, picker_state = 'unassigned', picker_assigned_at = null
     where id = p_order and picker_id = v_uid and picker_state = 'assigned';
    if not found then raise exception 'Too late — this order already moved on.'; end if;

    v_next := public.pick_partner('picker', p_order);
    if v_next is not null then
      update public.orders set picker_id = v_next, picker_state = 'assigned',
             picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_next;
      perform public._notify_partner(v_next, 'picker', p_order);
    else
      update public.orders set needs_owner = true where id = p_order;
    end if;
  end if;
end; $$;

revoke all on function public.partner_pass(uuid) from public;
grant execute on function public.partner_pass(uuid) to authenticated;

revoke all on function public.partner_pass(uuid) from anon;
