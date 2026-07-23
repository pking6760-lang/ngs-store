-- SECURITY FIX: NULL-safe ownership guards on partner_mark_* (an unassigned
-- order left v_rid NULL, and 'NULL = auth.uid()' skipped the check, letting
-- anyone mark orders Delivered/paid). Full definitions:

CREATE OR REPLACE FUNCTION public.partner_mark_delivered(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then raise exception 'Not your delivery.'; end if;
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

CREATE OR REPLACE FUNCTION public.partner_mark_packed(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_earn numeric; v_pid uuid; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or (v_pid is not null and v_pid = auth.uid())) then raise exception 'Not your order to pack.'; end if;
  v_earn := round(cfg.picker_pack_fee, 2);
  update public.orders
     set picker_state = 'packed', packed_at = now(), status = 'Packed'
   where id = p_order and picker_state <> 'packed';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  insert into public.order_economics (order_id, picker_earning)
    values (p_order, case when v_pid is not null then v_earn else 0 end)
    on conflict (order_id) do update set picker_earning = excluded.picker_earning, updated_at = now();
  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.partner_mark_out_for_delivery(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rid uuid;
begin
  select rider_id into v_rid from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  update public.orders
     set delivery_state = 'out_for_delivery', status = 'Out for delivery'
   where id = p_order and delivery_state = 'accepted';
end; $function$;

CREATE OR REPLACE FUNCTION public.partner_mark_returned(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_rid uuid; v_parent uuid; v_earn numeric; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, return_of into v_rid, v_parent from public.orders where id = p_order and is_return;
  if v_parent is null then raise exception 'Not a return order.'; end if;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then raise exception 'Not your pickup.'; end if;
  v_earn := round(coalesce(cfg.rider_base, 0), 2);
  update public.orders
     set delivery_state = 'returned', delivered_at = now(), status = 'Returned'
   where id = p_order and delivery_state <> 'returned';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  insert into public.order_economics (order_id, rider_earning)
    values (p_order, case when v_rid is not null then v_earn else 0 end)
    on conflict (order_id) do update set rider_earning = excluded.rider_earning, updated_at = now();
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
      values (v_rid, p_order, 'earning', v_earn, 'Return pickup', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
  perform public.process_return_refund(p_order);
end $function$;
