-- ════════════════════════════════════════════════════════════════════════════
-- Partner "run" flow: separate delivery / picking screens after Accept.
--   • Delivery gets an intermediate "out for delivery" step (two swipe steps:
--     Out for delivery → Delivered).
--   • get_my_task now returns the partner's earning for the order and, for the
--     picker, each item's barcode (so the picker can scan to pack).
-- ════════════════════════════════════════════════════════════════════════════

-- Rider marks the order picked up and on the way. Customer-facing status too.
create or replace function public.partner_mark_out_for_delivery(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_rid uuid;
begin
  select rider_id into v_rid from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then
    raise exception 'Not your delivery.';
  end if;
  update public.orders
     set delivery_state = 'out_for_delivery', status = 'Out for delivery'
   where id = p_order and delivery_state = 'accepted';
end; $function$;

revoke execute on function public.partner_mark_out_for_delivery(uuid) from public, anon;
grant execute on function public.partner_mark_out_for_delivery(uuid) to authenticated;

-- Extend the task read: add `earning` (what this partner makes on the order) and
-- item `barcode` (for the picker's scan-to-pack). Delivery earning is an estimate
-- from the same formula partner_mark_delivered uses.
-- (Return type changes — must drop the old signature first.)
drop function if exists public.get_my_task();
create or replace function public.get_my_task()
 returns table(order_id uuid, code text, task_role text, state text, is_cod boolean,
               paid boolean, cod_amount numeric, location jsonb, items jsonb,
               is_return boolean, earning numeric)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid; cfg public.ops_config;
begin
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  select * into cfg from public.ops_config where id = 1;
  return query
  select o.id, o.human_code,
    case when o.picker_id = v_uid then 'picker' else 'delivery' end,
    case when o.picker_id = v_uid then o.picker_state else o.delivery_state end,
    (lower(coalesce(o.payment_method, '')) = 'cod'),
    (coalesce(o.payment_status,'') = 'paid'),
    case when lower(coalesce(o.payment_method, '')) = 'cod' then o.total else null end,
    case when o.rider_id = v_uid then o.location else null end,
    case when o.picker_id = v_uid or coalesce(o.is_return,false) then
      (select jsonb_agg(jsonb_build_object(
                 'name', oi.name, 'qty', oi.qty,
                 'barcode', coalesce(p.barcode, ''), 'productId', oi.product_id))
         from public.order_items oi
         left join public.products p on p.id = oi.product_id
        where oi.order_id = o.id)
      else null end,
    coalesce(o.is_return, false),
    case
      when o.picker_id = v_uid then round(cfg.picker_pack_fee, 2)
      when o.rider_id = v_uid then round(
          (case when coalesce(o.member,false)
                then coalesce(cfg.rider_member_base, cfg.rider_base)
                else cfg.rider_base end)
        + greatest(coalesce(o.distance_km,0) - cfg.rider_free_km, 0) * cfg.rider_per_km
        + case when coalesce(cfg.surge_on,false) then cfg.peak_bonus else 0 end
      , 2)
      else 0 end
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$;
