-- Auto-complete a doorstep COD delivery the moment its QR/UPI payment is
-- confirmed. The delivery-completion logic (rider earning, ledger, order
-- economics, freeing the rider) is extracted into _complete_delivery so both
-- the manual "Delivered" slide and the auto-path share ONE implementation.

-- Internal: finish a delivery. No auth check — callers gate access.
create or replace function public._complete_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $$;

revoke all on function public._complete_delivery(uuid) from public;
revoke all on function public._complete_delivery(uuid) from anon;
revoke all on function public._complete_delivery(uuid) from authenticated;

-- The manual slide now just authorises, then delegates to the shared helper.
create or replace function public.partner_mark_delivered(p_order uuid)
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
  perform public._complete_delivery(p_order);
end; $$;

-- Auto-deliver: when a COD order's payment flips to paid while the rider is on
-- the delivery leg (accepted / out for delivery), the sale is complete at the
-- door — finish the delivery. Guarded so it never recurses or double-pays.
create or replace function public.trg_autodeliver_on_cod_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.payment_status = 'paid'
     and coalesce(old.payment_status,'') <> 'paid'
     and lower(coalesce(new.payment_method,'')) = 'cod'
     and new.rider_id is not null
     and new.delivery_state in ('accepted','out_for_delivery')
     and coalesce(new.is_return,false) = false then
    perform public._complete_delivery(new.id);
  end if;
  return new;
end; $$;

drop trigger if exists trg_autodeliver_cod_paid on public.orders;
create trigger trg_autodeliver_cod_paid
  after update of payment_status on public.orders
  for each row execute function public.trg_autodeliver_on_cod_paid();
