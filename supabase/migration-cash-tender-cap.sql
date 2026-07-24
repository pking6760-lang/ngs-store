-- Take-cash tender cap: a rider may not accept more cash than the COD ceiling
-- (ops_config.rider_cash_cap, ₹1000 — above that customers must pay online).
-- The exact bill amount always works even if config drifts; the cap bites on
-- over-tendering, so "₹2000 note for a ₹200 bill" is refused with a clear
-- message instead of minting ₹1800 of wallet change.
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
        v_change_cap numeric := 2000;   -- absolute backstop when no cash cap is configured
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

  -- Validate the cash BEFORE completing anything (raises roll the whole txn back).
  if v_cash then
    v_collected := greatest(coalesce(p_tendered, v_total), v_total);
    if p_tendered is not null
       and coalesce(cfg.rider_cash_cap, 0) > 0
       and v_collected > greatest(cfg.rider_cash_cap, v_total) then
      raise exception 'Cash above ₹% isn''t allowed — ask the customer to pay the rest by UPI.',
        trunc(cfg.rider_cash_cap)::text;
    end if;
    v_change := round(v_collected - v_total, 2);
    if v_change > v_change_cap then
      raise exception 'That is too much over the ₹% bill. Collect exact cash or give change.', round(v_total);
    end if;
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
      values (v_rid, p_order, 'cod_collected', -v_collected, v_collected,
              case when v_change > 0
                   then 'Cash collected ₹' || v_collected || ' — ₹' || v_change || ' change to customer wallet'
                   else 'Cash collected (COD)' end,
              auth.uid());
      if v_change > 0 and v_user is not null then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_user, v_change, 'change',
                'Change from ' || coalesce(v_code, 'your order') || ' (paid cash, no change)', p_order, v_rid);
      end if;
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $$;
