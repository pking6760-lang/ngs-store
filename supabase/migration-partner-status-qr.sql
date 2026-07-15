-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes: sync partner order actions to the admin-facing status strings, avoid
-- double-charging cash when a COD order is paid by QR at the door, and expose
-- 'paid' on the partner's task so the rider can offer a doorstep UPI QR.
-- (Supersedes the mark_packed/mark_delivered/get_my_task bodies in the earlier
-- migrations.)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.partner_mark_packed(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_pool numeric; v_earn numeric; v_pid uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or v_pid = auth.uid()) then raise exception 'Not your order to pack.'; end if;
  v_pool := public._ensure_pool(p_order);
  v_earn := round(public.taper(v_pool, cfg.picker_tier1_pct, cfg.picker_tier2_pct, cfg.picker_taper_break), 2);
  update public.orders
     set picker_state = 'packed', packed_at = now(), status = 'Packed',
         picker_earning = case when v_pid is not null then v_earn else 0 end
   where id = p_order;
  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $$;

create or replace function public.partner_mark_delivered(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_pool numeric; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total,
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid')
    into v_rid, v_total, v_cash from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  v_pool := public._ensure_pool(p_order);
  v_earn := round(greatest(public.taper(v_pool, cfg.rider_tier1_pct, cfg.rider_tier2_pct, cfg.rider_taper_break),
                           cfg.rider_floor), 2);
  update public.orders
     set delivery_state = 'delivered', delivered_at = now(), status = 'Delivered',
         rider_earning = case when v_rid is not null then v_earn else 0 end,
         payment_status = case when v_cash then 'paid' else payment_status end
   where id = p_order;
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, 'Delivery', auth.uid());
    if v_cash then
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $$;

drop function if exists public.get_my_task();
create or replace function public.get_my_task()
  returns table(order_id uuid, code text, task_role text, state text,
                is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb)
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
    (coalesce(o.payment_status,'') = 'paid'),
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
