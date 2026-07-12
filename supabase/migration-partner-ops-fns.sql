-- ═══════════════════════════════════════════════════════════════════════════
-- NGS Partner — Phase 0b: money & ops functions (the engine)
-- Margin/pool/earning · order completion → earnings + instant COD · wallet cash
-- ops · slot booking (capacity + no-cancel) · presence · eligibility/assign.
-- All SECURITY DEFINER with internal auth gates. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Presence: who's online and whether they're mid-order ────────────────────
create table if not exists public.partner_presence (
  user_id         uuid primary key,
  is_online       boolean not null default false,
  active_order_id uuid,
  went_online_at  timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.partner_presence enable row level security;
drop policy if exists presence_own   on public.partner_presence;
drop policy if exists presence_admin on public.partner_presence;
create policy presence_own   on public.partner_presence for select using (user_id = auth.uid() or public.is_admin());
create policy presence_admin on public.partner_presence for all using (public.is_admin()) with check (public.is_admin());

-- ── Margin, pool, earnings ──────────────────────────────────────────────────
-- Real margin from the cart: (sale − cost) per item, or default % where no cost.
create or replace function public.order_compute_margin(p_order uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    case when po.cost_price is not null then oi.qty * (oi.price - po.cost_price)
         else oi.qty * oi.price * (select default_margin_pct from ops_config where id = 1) end
  ), 0)
  from public.order_items oi
  left join public.product_ops po on po.product_id = oi.product_id
  where oi.order_id = p_order;
$$;

-- Pool = margin + the fees actually charged on the order (handling/delivery/surge).
create or replace function public.order_pool(p_order uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select public.order_compute_margin(p_order)
       + coalesce((select handling     from public.orders where id = p_order), 0)
       + coalesce((select delivery_fee from public.orders where id = p_order), 0)
       + coalesce((select surge_fee    from public.orders where id = p_order), 0);
$$;

-- Ensure margin+pool are stored on the order; returns the pool.
create or replace function public._ensure_pool(p_order uuid)
  returns numeric language plpgsql security definer set search_path = public as $$
declare v_margin numeric; v_pool numeric;
begin
  select order_margin, pool into v_margin, v_pool from public.orders where id = p_order;
  if v_pool is null then
    v_margin := public.order_compute_margin(p_order);
    v_pool   := public.order_pool(p_order);
    update public.orders set order_margin = round(v_margin, 2), pool = round(v_pool, 2) where id = p_order;
  end if;
  return v_pool;
end; $$;

-- ── Order lifecycle ─────────────────────────────────────────────────────────
create or replace function public.partner_accept(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_rid uuid;
begin
  select picker_id, rider_id into v_pid, v_rid from public.orders where id = p_order;
  if v_pid = auth.uid() then
    update public.orders set picker_state = 'accepted' where id = p_order;
  elsif v_rid = auth.uid() then
    update public.orders set delivery_state = 'accepted' where id = p_order;
  else
    raise exception 'This order is not assigned to you.';
  end if;
end; $$;

-- Picker marks packed → credit picker earning (unless the owner did it).
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
     set picker_state = 'packed', packed_at = now(),
         picker_earning = case when v_pid is not null then v_earn else 0 end
   where id = p_order;

  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $$;

-- Delivery marks delivered → credit rider earning + instant COD cash deduction.
create or replace function public.partner_mark_delivered(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_pool numeric; v_earn numeric; v_rid uuid; v_total numeric; v_cod boolean;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, lower(coalesce(payment_method, '')) = 'cod'
    into v_rid, v_total, v_cod from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;

  v_pool := public._ensure_pool(p_order);
  v_earn := round(greatest(public.taper(v_pool, cfg.rider_tier1_pct, cfg.rider_tier2_pct, cfg.rider_taper_break),
                           cfg.rider_floor), 2);

  update public.orders
     set delivery_state = 'delivered', delivered_at = now(), status = 'delivered',
         rider_earning = case when v_rid is not null then v_earn else 0 end,
         payment_status = case when v_cod then 'paid' else payment_status end
   where id = p_order;

  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, 'Delivery', auth.uid());
    if v_cod then
      -- the moment cash is taken: wallet drops, cash-in-hand rises (owed to shop)
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $$;

-- ── Wallet cash operations (admin-confirmed) ────────────────────────────────
create or replace function public.partner_deposit_cash(p_user uuid, p_amount numeric)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the shop can confirm a cash deposit.'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive.'; end if;
  insert into public.wallet_ledger (partner_id, kind, amount, cash_delta, note, created_by)
  values (p_user, 'cod_deposited', p_amount, -p_amount, 'Cash deposited at shop', auth.uid());
end; $$;

create or replace function public.partner_record_payout(p_user uuid, p_amount numeric, p_note text default null)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the shop can record a payout.'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive.'; end if;
  insert into public.wallet_ledger (partner_id, kind, amount, note, created_by)
  values (p_user, 'payout', -p_amount, coalesce(p_note, 'Weekly payout'), auth.uid());
end; $$;

-- Strike ladder: 1st = warning, 2nd = fine_2, 3rd+ = fine_3.
create or replace function public.partner_penalize(p_user uuid, p_reason text, p_order uuid default null, p_slot uuid default null)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_count int; v_fine numeric;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into cfg from public.ops_config where id = 1;
  insert into public.partner_strikes (partner_id, reason, order_id, slot_id) values (p_user, p_reason, p_order, p_slot);
  select count(*) into v_count from public.partner_strikes where partner_id = p_user;
  v_fine := case when v_count = 1 then 0 when v_count = 2 then cfg.penalty_fine_2 else cfg.penalty_fine_3 end;
  if v_fine > 0 then
    insert into public.wallet_ledger (partner_id, kind, amount, note, created_by)
    values (p_user, 'penalty', -v_fine, 'Penalty: ' || p_reason || ' (strike ' || v_count || ')', auth.uid());
  end if;
end; $$;

-- ── Slots: book a 2-hour slot (capacity 10/role, no cancel, in store hours) ──
create or replace function public.book_slot(p_role text, p_date date, p_hour int)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_cnt int; v_status text; v_role text;
begin
  select * into cfg from public.ops_config where id = 1;
  select status, role into v_status, v_role from public.partners where user_id = auth.uid();
  if v_status is distinct from 'approved' then raise exception 'Only approved partners can book slots.'; end if;
  if p_role not in ('picker', 'delivery') then raise exception 'Invalid role.'; end if;
  if v_role is distinct from p_role then raise exception 'You can only book slots for your own role.'; end if;
  if p_hour < 0 or p_hour > 22 or p_hour % 2 <> 0 then raise exception 'Invalid slot time.'; end if;
  if p_hour < cfg.store_open_hour or p_hour >= cfg.store_close_hour then raise exception 'That slot is outside store hours.'; end if;
  select count(*) into v_cnt from public.partner_slots
   where slot_date = p_date and start_hour = p_hour and role = p_role and status <> 'cancelled';
  if v_cnt >= 10 then raise exception 'This slot is full — 10 partners already booked it.'; end if;
  insert into public.partner_slots (partner_id, role, slot_date, start_hour)
  values (auth.uid(), p_role, p_date, p_hour);
end; $$;

-- ── Presence toggle ─────────────────────────────────────────────────────────
create or replace function public.set_online(p_online boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.partner_presence (user_id, is_online, went_online_at, updated_at)
  values (auth.uid(), p_online, case when p_online then now() else null end, now())
  on conflict (user_id) do update
     set is_online = excluded.is_online,
         went_online_at = case when excluded.is_online then coalesce(public.partner_presence.went_online_at, now()) else null end,
         updated_at = now();
end; $$;

-- ── Dispatch building blocks ────────────────────────────────────────────────
-- Pick ONE eligible partner: approved · same role · online · free · in the
-- current 2-hour slot (IST) · (delivery+COD) within cash-cap headroom.
-- Fair tie-break: whoever has been waiting free the longest.
create or replace function public.pick_partner(p_role text, p_order uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_total numeric; v_cod boolean; v_hour int; v_date date; v_uid uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  select total, lower(coalesce(payment_method, '')) = 'cod' into v_total, v_cod from public.orders where id = p_order;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;

  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl on sl.partner_id = pa.user_id
       and sl.slot_date = v_date and sl.start_hour = v_hour and sl.role = p_role and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role = p_role
    and pr.is_online = true and pr.active_order_id is null
    and (p_role <> 'delivery' or not v_cod or (public.partner_cash_in_hand(pa.user_id) + v_total) <= cfg.rider_cash_cap)
  order by pr.went_online_at asc nulls last
  limit 1;
  return v_uid;
end; $$;

create or replace function public.assign_order(p_order uuid, p_role text, p_user uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'Not allowed.'; end if;
  if p_role = 'picker' then
    update public.orders set picker_id = p_user, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
  else
    update public.orders set rider_id = p_user, delivery_state = 'assigned', rider_assigned_at = now() where id = p_order;
  end if;
  update public.partner_presence set active_order_id = p_order where user_id = p_user;
end; $$;

-- ── Execute grants (functions gate internally) ──────────────────────────────
grant execute on function public.taper(numeric,numeric,numeric,numeric) to authenticated, anon;
grant execute on function public.partner_wallet_balance(uuid) to authenticated;
grant execute on function public.partner_cash_in_hand(uuid) to authenticated;
grant execute on function public.order_compute_margin(uuid) to authenticated;
grant execute on function public.order_pool(uuid) to authenticated;
grant execute on function public.partner_accept(uuid) to authenticated;
grant execute on function public.partner_mark_packed(uuid) to authenticated;
grant execute on function public.partner_mark_delivered(uuid) to authenticated;
grant execute on function public.partner_deposit_cash(uuid,numeric) to authenticated;
grant execute on function public.partner_record_payout(uuid,numeric,text) to authenticated;
grant execute on function public.partner_penalize(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.book_slot(text,date,int) to authenticated;
grant execute on function public.set_online(boolean) to authenticated;
grant execute on function public.pick_partner(text,uuid) to authenticated;
grant execute on function public.assign_order(uuid,text,uuid) to authenticated;

-- ── Slot availability counts (for the booking grid) ─────────────────────────
create or replace function public.slot_counts(p_date date)
  returns table(role text, start_hour int, cnt bigint)
  language sql stable security definer set search_path = public as $$
  select role, start_hour, count(*)
  from public.partner_slots
  where slot_date = p_date and status <> 'cancelled'
  group by role, start_hour;
$$;
grant execute on function public.slot_counts(date) to authenticated;
