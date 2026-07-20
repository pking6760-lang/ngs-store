-- Keep subscription "milk round" orders out of the single-task full-screen flow.
-- They're shown as a batch round (get_my_round), so get_my_task must ignore them
-- or it would hijack the one-order delivery screen with a single milk stop.
create or replace function public.get_my_task()
 returns table(order_id uuid, code text, task_role text, state text, is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb, is_return boolean, earning numeric)
 language plpgsql security definer set search_path to 'public' as $function$
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
     and not (o.subscription_id is not null and not coalesce(o.is_subscription,false))
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$;

select 'get_my_task excludes milk round' as status;
