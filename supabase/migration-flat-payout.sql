-- Flat, predictable partner payout (gig-app style), tunable by the owner.
alter table public.ops_config add column if not exists rider_base numeric not null default 22;
alter table public.ops_config add column if not exists rider_per_km numeric not null default 5;
alter table public.ops_config add column if not exists rider_free_km numeric not null default 2;
alter table public.ops_config add column if not exists peak_bonus numeric not null default 12;
alter table public.ops_config add column if not exists picker_pack_fee numeric not null default 8;

-- Delivery pay = base + (distance beyond the free radius × per-km) + peak bonus.
-- Predictable for the rider, capped for you (never a % windfall on a big order).
create or replace function public.partner_mark_delivered(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean; v_dist numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km,
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid')
    into v_rid, v_total, v_dist, v_cash from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  perform public._ensure_pool(p_order);  -- keep order_margin fresh for reporting
  v_earn := round(
      cfg.rider_base
    + greatest(coalesce(v_dist,0) - cfg.rider_free_km, 0) * cfg.rider_per_km
    + case when coalesce(cfg.surge_on,false) then cfg.peak_bonus else 0 end
  , 2);
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
end; $function$;

-- Packing pay = a flat fee per order (effort is roughly constant).
create or replace function public.partner_mark_packed(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_earn numeric; v_pid uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or v_pid = auth.uid()) then raise exception 'Not your order to pack.'; end if;
  v_earn := round(cfg.picker_pack_fee, 2);
  update public.orders
     set picker_state = 'packed', packed_at = now(), status = 'Packed',
         picker_earning = case when v_pid is not null then v_earn else 0 end
   where id = p_order;
  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $function$;

-- Return pickup pays the delivery base (a full trip, no distance/peak stack).
create or replace function public.partner_mark_returned(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_rid uuid; v_parent uuid; v_earn numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, return_of into v_rid, v_parent from public.orders where id = p_order and is_return;
  if v_parent is null then raise exception 'Not a return order.'; end if;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your pickup.'; end if;
  v_earn := round(coalesce(cfg.rider_base, 0), 2);
  update public.orders
     set delivery_state = 'returned', delivered_at = now(), status = 'Returned',
         rider_earning = case when v_rid is not null then v_earn else 0 end
   where id = p_order;
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
      values (v_rid, p_order, 'earning', v_earn, 'Return pickup', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
  perform public.process_return_refund(p_order);
end $function$;
