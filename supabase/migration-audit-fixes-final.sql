-- FINAL pre-publish audit remediation (customer + partner reachable surface).

-- ── H1: cap the "Take cash" change so a rider can't mint customer-wallet money ──
-- p_tendered is client-supplied. Reject an implausible over-payment instead of
-- crediting an unbounded amount to the customer's wallet.
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
        v_change_cap numeric := 2000;   -- most a rider can hand back as wallet change
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

-- ── M2: advance_order_status must not let a rider flip payment_status to paid ──
-- Only an admin may mark an order paid via this generic transition; a rider's
-- "delivered" goes through partner_mark_delivered/_complete_delivery which books
-- the cash properly. This closes marking an unpaid online order as paid.
create or replace function public.advance_order_status(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders;
  v_flow  text[] := array['Placed', 'Packed', 'Out for delivery', 'Delivered'];
  v_cur   int; v_new int;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin()
          or (v_order.rider_id  is not null and v_order.rider_id  = auth.uid())
          or (v_order.picker_id is not null and v_order.picker_id = auth.uid())) then
    raise exception 'Not your order.';
  end if;
  v_new := array_position(v_flow, p_status);
  if v_new is null then raise exception 'Invalid status.'; end if;
  v_cur := array_position(v_flow, v_order.status);
  if v_cur is not null and v_new < v_cur then
    raise exception 'Status can only move forward.';
  end if;
  update public.orders set
    status = p_status,
    delivered_at = case when p_status = 'Delivered' and delivered_at is null then now() else delivered_at end,
    payment_status = case when p_status = 'Delivered' and payment_status <> 'paid' and public.is_admin()
                          then 'paid' else payment_status end
  where id = p_order;
end; $$;

-- ── Privacy: don't leak the caller's real name/id/number to a customer or
-- partner callee (masked calling). Keep full identity only when the callee is
-- the shop owner/admin, who legitimately needs to know who's calling. ──
create or replace function public.call_order_party(p_order uuid)
returns calls
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); o public.orders; v_callee uuid;
        v_name text; v_role text; v_ref text; v_phone text; v_call public.calls; v_hide boolean;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;

  if v_uid = o.user_id then
    v_callee := coalesce(o.rider_id, public._shop_owner_id());
    v_role := 'customer';
  elsif v_uid = o.rider_id or v_uid = o.picker_id or public.is_admin() then
    v_callee := o.user_id;
    v_role := case when v_uid = o.rider_id or v_uid = o.picker_id then 'partner' else 'owner' end;
  else
    raise exception 'You are not part of this order.';
  end if;
  if v_callee is null or v_callee = v_uid then raise exception 'No one to call on this order yet.'; end if;

  if exists (
    select 1 from public.calls
     where (callee_id = v_callee or caller_id = v_callee)
       and status in ('ringing','accepted')
       and created_at > now() - interval '90 seconds'
  ) then
    raise exception 'NGS_BUSY';
  end if;

  if v_role = 'customer' then
    select coalesce(name,'Customer'), customer_code, phone
      into v_name, v_ref, v_phone from public.profiles where id = v_uid;
  else
    v_name := coalesce(
      (select full_name from public.partners where user_id = v_uid),
      (select name from public.profiles where id = v_uid), 'NGS');
    v_ref := (select emp_code from public.partners where user_id = v_uid);
    v_phone := (select phone from public.profiles where id = v_uid);
  end if;

  -- The callee's app only shows real identity to the owner/admin. For a customer
  -- or partner callee, store only a generic title so the number/name/id can't be
  -- pulled out of the row on the client.
  v_hide := not (v_callee = public._shop_owner_id()
                 or exists (select 1 from public.profiles where id = v_callee and role = 'admin'));
  if v_hide then
    v_name := case v_role when 'customer' then 'Customer'
                          when 'partner' then 'Delivery partner' else 'NGS Store' end;
    v_ref := null;
    v_phone := null;
  end if;

  insert into public.calls (caller_id, callee_id, caller_name, caller_role, caller_ref, caller_phone, order_id)
    values (v_uid, v_callee, v_name, v_role, v_ref, v_phone, p_order) returning * into v_call;
  perform public._ring_call(v_call);
  return v_call;
end; $$;

-- ── Privacy: the milk-round payload no longer carries the customer's phone
-- number (the driver calls via the masked in-app call, never a raw number). ──
create or replace function public.get_my_round()
returns table(order_id uuid, code text, state text, location jsonb, address text, customer text, phone text, items jsonb, earning numeric, total numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code, o.delivery_state, o.location, o.address, o.customer_name, null::text,
    (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty))
       from public.order_items oi where oi.order_id = o.id),
    round(0.70 * coalesce(o.handling,0), 2), o.total
  from public.orders o
  where o.rider_id = v_uid
    and o.subscription_id is not null and not coalesce(o.is_subscription,false)
    and o.delivery_state not in ('delivered','returned')
    and o.deliver_on = v_today
  order by o.distance_km asc nulls last, o.human_code;
end; $$;

-- ── L1: defense-in-depth — revoke EXECUTE from anon/public on admin & payout
-- functions (each already gates on is_admin(), but anon should never reach them). ──
do $$
declare r record;
begin
  for r in select oid::regprocedure::text as sig from pg_proc where proname in (
    'admin_wallet_adjust','set_staff_role','partner_record_payout','partner_deposit_cash',
    'admin_grant_membership','admin_create_return','admin_request_kyc','admin_request_partner_selfie',
    'set_partner_status','admin_refund_to_wallet','admin_customer_wallet_credit','admin_clear_strikes',
    'partner_clear_strikes','partner_wallet_adjust','admin_smart_reprice','advance_order_status')
  loop
    execute 'revoke all on function '||r.sig||' from public';
    execute 'revoke all on function '||r.sig||' from anon';
    execute 'grant execute on function '||r.sig||' to authenticated';
  end loop;
end $$;
