-- Cash with no change: when a customer pays cash for a COD order but the rider
-- can't give change (e.g. ₹193 order, ₹500 given), the rider keeps the full
-- note and the difference (₹307) is credited to the customer's NGS wallet — so
-- no physical change is needed and the money isn't lost. The rider's cash-in-
-- hand reflects the full amount collected (they owe the shop that, and the shop
-- now owes the customer the change as wallet credit).

-- Replace _complete_delivery with a version that accepts an optional tendered
-- amount (what the customer actually handed over in cash).
drop function if exists public._complete_delivery(uuid);
create or replace function public._complete_delivery(p_order uuid, p_tendered numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean;
        v_dist numeric; v_member boolean; v_base numeric; v_upd int;
        v_is_milk boolean; v_handling numeric; v_user uuid; v_code text;
        v_collected numeric; v_change numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km, coalesce(member, false),
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid'),
         (subscription_id is not null and not coalesce(is_subscription,false)), coalesce(handling,0),
         user_id, human_code
    into v_rid, v_total, v_dist, v_member, v_cash, v_is_milk, v_handling, v_user, v_code
    from public.orders where id = p_order;
  perform public._ensure_pool(p_order);
  if v_is_milk then
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
  if v_upd = 0 then return; end if;               -- already delivered → no double pay
  insert into public.order_economics (order_id, rider_earning)
    values (p_order, case when v_rid is not null then v_earn else 0 end)
    on conflict (order_id) do update set rider_earning = excluded.rider_earning, updated_at = now();
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, case when v_is_milk then 'Milk round' else 'Delivery' end, auth.uid());
    if v_cash then
      -- Cash actually taken: the tendered note if it's more than the bill
      -- (no change given), otherwise the exact bill.
      v_collected := greatest(coalesce(p_tendered, v_total), v_total);
      v_change := round(v_collected - v_total, 2);
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_collected, v_collected,
              case when v_change > 0
                   then 'Cash collected ₹' || v_collected || ' — ₹' || v_change || ' change to customer wallet'
                   else 'Cash collected (COD)' end,
              auth.uid());
      -- Change owed to the customer → their NGS wallet (used on the next order).
      if v_change > 0 and v_user is not null then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_user, v_change, 'change',
                'Change from ' || coalesce(v_code, 'your order') || ' (paid cash, no change)', p_order, v_rid);
      end if;
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $$;

revoke all on function public._complete_delivery(uuid, numeric) from public;
revoke all on function public._complete_delivery(uuid, numeric) from anon;
revoke all on function public._complete_delivery(uuid, numeric) from authenticated;

-- Manual "Delivered" slide — now takes the optional tendered amount and passes
-- it through. Called with just p_order for exact cash / prepaid / QR-paid.
drop function if exists public.partner_mark_delivered(uuid);
create or replace function public.partner_mark_delivered(p_order uuid, p_tendered numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rid uuid;
begin
  select rider_id into v_rid from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  perform public._complete_delivery(p_order, p_tendered);
end; $$;

revoke all on function public.partner_mark_delivered(uuid, numeric) from public;
revoke all on function public.partner_mark_delivered(uuid, numeric) from anon;
grant execute on function public.partner_mark_delivered(uuid, numeric) to authenticated;
