-- ════════════════════════════════════════════════════════════════════════════
-- H2 · Stop leaking per-order cost/profit to the customer.
-- order_margin / pool / picker_earning / rider_earning lived on public.orders,
-- which a customer can read for their OWN rows via the API — disclosing the
-- shop's buying cost & profit. Nothing actually READS these off `orders` (the
-- admin recomputes profit from items + costs + rates), so move them to an
-- admin-only side table and drop them from orders. Apps use `select *` and
-- never reference these columns, so this is transparent to every app.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.order_economics (
  order_id       uuid primary key references public.orders(id) on delete cascade,
  order_margin   numeric,
  pool           numeric,
  picker_earning numeric,
  rider_earning  numeric,
  updated_at     timestamptz default now()
);
alter table public.order_economics enable row level security;
drop policy if exists oe_admin on public.order_economics;
create policy oe_admin on public.order_economics for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.order_economics from anon, authenticated;

-- Preserve existing values.
insert into public.order_economics (order_id, order_margin, pool, picker_earning, rider_earning)
  select id, order_margin, pool, picker_earning, rider_earning from public.orders
  on conflict (order_id) do nothing;

-- _ensure_pool now caches margin/pool into the side table.
create or replace function public._ensure_pool(p_order uuid)
 returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare v_margin numeric; v_pool numeric;
begin
  select order_margin, pool into v_margin, v_pool from public.order_economics where order_id = p_order;
  if v_pool is null then
    v_margin := public.order_compute_margin(p_order);
    v_pool   := public.order_pool(p_order);
    insert into public.order_economics (order_id, order_margin, pool)
      values (p_order, round(v_margin,2), round(v_pool,2))
      on conflict (order_id) do update set order_margin = excluded.order_margin, pool = excluded.pool, updated_at = now();
  end if;
  return v_pool;
end; $function$;

-- partner_mark_delivered — idempotent + writes rider_earning to the side table.
create or replace function public.partner_mark_delivered(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean; v_dist numeric; v_member boolean; v_base numeric; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km, coalesce(member, false),
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid')
    into v_rid, v_total, v_dist, v_member, v_cash from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  perform public._ensure_pool(p_order);
  v_base := case when v_member then coalesce(cfg.rider_member_base, cfg.rider_base) else cfg.rider_base end;
  v_earn := round(
      v_base
    + greatest(coalesce(v_dist,0) - cfg.rider_free_km, 0) * cfg.rider_per_km
    + case when coalesce(cfg.surge_on,false) then cfg.peak_bonus else 0 end, 2);
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
    values (v_rid, p_order, 'earning', v_earn, 'Delivery', auth.uid());
    if v_cash then
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $function$;

-- partner_mark_packed — idempotent + writes picker_earning to the side table.
create or replace function public.partner_mark_packed(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_earn numeric; v_pid uuid; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or v_pid = auth.uid()) then raise exception 'Not your order to pack.'; end if;
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

-- partner_mark_returned — idempotent + writes rider_earning to the side table.
create or replace function public.partner_mark_returned(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_rid uuid; v_parent uuid; v_earn numeric; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, return_of into v_rid, v_parent from public.orders where id = p_order and is_return;
  if v_parent is null then raise exception 'Not a return order.'; end if;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your pickup.'; end if;
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

-- Now the columns are unreferenced on `orders` — drop them (closes the leak).
alter table public.orders
  drop column if exists order_margin,
  drop column if exists pool,
  drop column if exists picker_earning,
  drop column if exists rider_earning;
