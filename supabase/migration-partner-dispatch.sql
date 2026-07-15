-- ═══════════════════════════════════════════════════════════════════════════
-- NGS Partner — dispatch: auto-assign an order to one eligible partner on
-- placement, and expose the partner's current task with MINIMAL fields only.
-- ═══════════════════════════════════════════════════════════════════════════

-- Assign delivery/picker to one eligible partner per coverage mode. Inlined
-- (not via assign_order) so it runs inside the order-insert trigger.
create or replace function public.dispatch_order(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_uid uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  if cfg.coverage_delivery = 'staff' and (select rider_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('delivery', p_order);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
    end if;
  end if;
  if cfg.coverage_picking = 'staff' and (select picker_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('picker', p_order);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
    end if;
  end if;
end; $$;

create or replace function public.trg_dispatch() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  begin perform public.dispatch_order(new.id); exception when others then null; end;
  return new;
end; $$;
drop trigger if exists dispatch_on_insert on public.orders;
create trigger dispatch_on_insert after insert on public.orders
  for each row execute function public.trg_dispatch();

-- The partner's current task — MINIMAL fields only (privacy). Delivery sees
-- location + COD amount (no name/phone/address text/items); picker sees items.
create or replace function public.get_my_task()
  returns table(order_id uuid, code text, task_role text, state text,
                is_cod boolean, cod_amount numeric, location jsonb, items jsonb)
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code,
    case when o.picker_id = v_uid then 'picker' else 'delivery' end,
    case when o.picker_id = v_uid then o.picker_state else o.delivery_state end,
    (lower(coalesce(o.payment_method, '')) = 'cod'),
    case when lower(coalesce(o.payment_method, '')) = 'cod' then o.total else null end,
    case when o.rider_id = v_uid then o.location else null end,
    case when o.picker_id = v_uid then
      (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty)) from public.order_items oi where oi.order_id = o.id)
      else null end
  from public.orders o
  where (o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state <> 'delivered')
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $$;
grant execute on function public.get_my_task() to authenticated;
grant execute on function public.dispatch_order(uuid) to authenticated;
