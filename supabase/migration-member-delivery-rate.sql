-- ════════════════════════════════════════════════════════════════════════════
-- Member delivery rate. Prime members pay no delivery fee and no handling, so a
-- member drop otherwise costs us the full rider base with no delivery income.
-- This adds a separate, lower flat base used only for member orders. Distance +
-- peak still apply on top, so riders aren't discouraged from taking far / rainy
-- member deliveries (which would hurt us while we're scaling).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ops_config
  add column if not exists rider_member_base numeric not null default 16;

create or replace function public.partner_mark_delivered(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean; v_dist numeric; v_member boolean; v_base numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km, coalesce(member, false),
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid')
    into v_rid, v_total, v_dist, v_member, v_cash from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  perform public._ensure_pool(p_order);  -- keep order_margin fresh for reporting

  -- Members use the lower member base (they pay no delivery/handling); distance
  -- and peak still apply so a far or rainy member drop still pays fairly.
  v_base := case when v_member then coalesce(cfg.rider_member_base, cfg.rider_base) else cfg.rider_base end;
  v_earn := round(
      v_base
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
