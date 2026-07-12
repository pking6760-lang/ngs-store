-- ═══ Dispatch reliability: rollover + fallback + penalties + slot sweep ═══

alter table public.orders
  add column if not exists dispatch_tried uuid[] not null default '{}',
  add column if not exists needs_owner boolean not null default false;

-- Online session log (for fair slot-no-show detection).
create table if not exists public.partner_online_log (
  id bigserial primary key,
  user_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists idx_online_log_user on public.partner_online_log(user_id, started_at);
alter table public.partner_online_log enable row level security;
drop policy if exists online_log_admin on public.partner_online_log;
create policy online_log_admin on public.partner_online_log for select using (public.is_admin());

-- Presence toggle now also logs the session.
create or replace function public.set_online(p_online boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.partner_presence (user_id, is_online, went_online_at, updated_at)
  values (auth.uid(), p_online, case when p_online then now() else null end, now())
  on conflict (user_id) do update
     set is_online = excluded.is_online,
         went_online_at = case when excluded.is_online then coalesce(public.partner_presence.went_online_at, now()) else null end,
         updated_at = now();
  if p_online then
    if not exists (select 1 from public.partner_online_log where user_id = auth.uid() and ended_at is null) then
      insert into public.partner_online_log (user_id) values (auth.uid());
    end if;
  else
    update public.partner_online_log set ended_at = now() where user_id = auth.uid() and ended_at is null;
  end if;
end; $$;

-- pick_partner: also exclude partners already tried for this order.
create or replace function public.pick_partner(p_role text, p_order uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_total numeric; v_cod boolean; v_hour int; v_date date; v_uid uuid; v_tried uuid[];
begin
  select * into cfg from public.ops_config where id = 1;
  select total, lower(coalesce(payment_method, '')) = 'cod', coalesce(dispatch_tried,'{}')
    into v_total, v_cod, v_tried from public.orders where id = p_order;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;
  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl on sl.partner_id = pa.user_id
       and sl.slot_date = v_date and sl.start_hour = v_hour and sl.role = p_role and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role = p_role
    and pr.is_online = true and pr.active_order_id is null
    and pa.user_id <> all(v_tried)
    and (p_role <> 'delivery' or not v_cod or (public.partner_cash_in_hand(pa.user_id) + v_total) <= cfg.rider_cash_cap)
  order by pr.went_online_at asc nulls last
  limit 1;
  return v_uid;
end; $$;

-- Penalize: allow the system (cron, no auth) as well as admin.
create or replace function public.partner_penalize(p_user uuid, p_reason text, p_order uuid default null, p_slot uuid default null)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_count int; v_fine numeric;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'Not allowed.'; end if;
  select * into cfg from public.ops_config where id = 1;
  insert into public.partner_strikes (partner_id, reason, order_id, slot_id) values (p_user, p_reason, p_order, p_slot);
  select count(*) into v_count from public.partner_strikes where partner_id = p_user;
  v_fine := case when v_count = 1 then 0 when v_count = 2 then cfg.penalty_fine_2 else cfg.penalty_fine_3 end;
  if v_fine > 0 then
    insert into public.wallet_ledger (partner_id, kind, amount, note, created_by)
    values (p_user, 'penalty', -v_fine, 'Penalty: ' || p_reason || ' (strike ' || v_count || ')', auth.uid());
  end if;
end; $$;

-- The tick: roll over unaccepted assignments, penalize dodgers, fall back to owner.
create or replace function public.dispatch_tick()
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; o record; v_uid uuid; v_deadline interval;
begin
  select * into cfg from public.ops_config where id = 1;
  v_deadline := make_interval(secs => cfg.assignment_timeout_seconds);

  for o in select id, rider_id from public.orders
           where delivery_state = 'assigned' and rider_id is not null
             and rider_assigned_at < now() - v_deadline loop
    perform public.partner_penalize(o.rider_id, 'dodged_order', o.id, null);
    update public.partner_presence set active_order_id = null where user_id = o.rider_id and active_order_id = o.id;
    update public.orders set dispatch_tried = array_append(dispatch_tried, o.rider_id),
       rider_id = null, delivery_state = 'unassigned', rider_assigned_at = null where id = o.id;
    v_uid := public.pick_partner('delivery', o.id);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = o.id;
      update public.partner_presence set active_order_id = o.id where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', o.id);
    else
      update public.orders set needs_owner = true where id = o.id;
    end if;
  end loop;

  for o in select id, picker_id from public.orders
           where picker_state = 'assigned' and picker_id is not null
             and picker_assigned_at < now() - v_deadline loop
    perform public.partner_penalize(o.picker_id, 'dodged_order', o.id, null);
    update public.partner_presence set active_order_id = null where user_id = o.picker_id and active_order_id = o.id;
    update public.orders set dispatch_tried = array_append(dispatch_tried, o.picker_id),
       picker_id = null, picker_state = 'unassigned', picker_assigned_at = null where id = o.id;
    v_uid := public.pick_partner('picker', o.id);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = o.id;
      update public.partner_presence set active_order_id = o.id where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', o.id);
    else
      update public.orders set needs_owner = true where id = o.id;
    end if;
  end loop;
end; $$;

-- Slot sweep: after a slot ends, mark it fulfilled or missed (with fair exemption).
create or replace function public.slot_sweep()
  returns void language plpgsql security definer set search_path = public as $$
declare s record; v_start timestamptz; v_end timestamptz; v_online boolean; v_jobs int;
begin
  for s in select * from public.partner_slots where status = 'booked' loop
    v_start := (s.slot_date::text || ' ' || lpad(s.start_hour::text, 2, '0') || ':00:00')::timestamp at time zone 'Asia/Kolkata';
    v_end := v_start + interval '2 hours';
    if now() < v_end then continue; end if;
    select exists(select 1 from public.partner_online_log l where l.user_id = s.partner_id
       and l.started_at < v_end and coalesce(l.ended_at, now()) > v_start) into v_online;
    select count(*) into v_jobs from public.orders o
      where (o.rider_id = s.partner_id and o.delivered_at between v_start and v_end)
         or (o.picker_id = s.partner_id and o.packed_at between v_start and v_end);
    if v_online or v_jobs > 0 then
      update public.partner_slots set status = 'fulfilled', fulfilled_at = now() where id = s.id;
    else
      update public.partner_slots set status = 'missed' where id = s.id;
      perform public.partner_penalize(s.partner_id, 'slot_no_show', null, s.id);
    end if;
  end loop;
end; $$;

-- Scheduling (run once, requires pg_cron):
--   create extension if not exists pg_cron;
--   select cron.schedule('ngs-dispatch-tick', '30 seconds', $$select public.dispatch_tick();$$);
--   select cron.schedule('ngs-slot-sweep', '*/5 * * * *', $$select public.slot_sweep();$$);
