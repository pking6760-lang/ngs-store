-- Delivery-flow guards (from live field testing):
--   1. A rider can't slide "Out for delivery" until the order is marked Packed.
--   2. A rider can't complete a delivery (QR/Take cash → Delivered) until they
--      have actually gone Out for delivery. (Milk rounds and return pickups
--      keep their own simpler flows; admin can always override.)
--   3. Cash-in-hand can never go negative: a shop deposit is clamped to what
--      the rider actually holds.
--   4. get_my_task now tells the app whether the order is packed, so the UI
--      can show "waiting for packing" instead of the go-slider.

-- 1 ─ out-for-delivery requires Packed ──────────────────────────────────────
create or replace function public.partner_mark_out_for_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rid uuid; v_status text; v_ret boolean; v_milk boolean;
begin
  select rider_id, status, coalesce(is_return, false),
         (subscription_id is not null and not coalesce(is_subscription, false))
    into v_rid, v_status, v_ret, v_milk
    from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  if not public.is_admin() and not v_ret and not v_milk
     and v_status not in ('Packed', 'Out for delivery') then
    raise exception 'This order isn''t packed yet — the picker has to finish first.';
  end if;
  update public.orders
     set delivery_state = 'out_for_delivery', status = 'Out for delivery'
   where id = p_order and delivery_state = 'accepted';
end; $$;

-- 2 ─ delivered requires out-for-delivery ───────────────────────────────────
create or replace function public.partner_mark_delivered(p_order uuid, p_tendered numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rid uuid; v_state text; v_ret boolean; v_milk boolean;
begin
  select rider_id, delivery_state, coalesce(is_return, false),
         (subscription_id is not null and not coalesce(is_subscription, false))
    into v_rid, v_state, v_ret, v_milk
    from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  if not public.is_admin() and not v_ret and not v_milk
     and v_state <> 'out_for_delivery' then
    raise exception 'Slide "Out for delivery" first — collect the payment at the customer''s door.';
  end if;
  perform public._complete_delivery(p_order, p_tendered);
end; $$;

-- 3 ─ a deposit can never exceed the cash the rider holds ───────────────────
create or replace function public.partner_deposit_cash(p_user uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_cash numeric;
begin
  if not public.is_admin() then raise exception 'Only the shop can confirm a cash deposit.'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive.'; end if;
  select coalesce(sum(cash_delta), 0) into v_cash
    from public.wallet_ledger where partner_id = p_user;
  if p_amount > v_cash then
    raise exception 'They hold ₹% in cash — you can''t record a ₹% deposit.',
      trunc(v_cash)::text, trunc(p_amount)::text;
  end if;
  insert into public.wallet_ledger (partner_id, kind, amount, cash_delta, note, created_by)
  values (p_user, 'cod_deposited', p_amount, -p_amount, 'Cash deposited at shop', auth.uid());
end; $$;

-- 4 ─ task payload gains "packed" (return-type change → drop first) ─────────
drop function if exists public.get_my_task();
create function public.get_my_task()
returns table(order_id uuid, code text, task_role text, state text, is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb, is_return boolean, earning numeric, packed boolean)
language plpgsql
security definer
set search_path to 'public'
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
      else 0 end,
    (o.status in ('Packed', 'Out for delivery', 'Delivered')
     or coalesce(o.is_return, false)
     or (o.subscription_id is not null and not coalesce(o.is_subscription, false)))
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
     and not (o.subscription_id is not null and not coalesce(o.is_subscription,false))
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$;
revoke all on function public.get_my_task() from public, anon;
grant execute on function public.get_my_task() to authenticated;
