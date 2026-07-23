-- ════════════════════════════════════════════════════════════════════════════
-- Subscription (milk round) was being assigned to any partner flagged online —
-- even one who booked no slot for today. A partner who went online once and
-- never went offline kept receiving the daily round forever.
--
-- Normal-order dispatch (pick_partner) already requires a booked, active slot
-- for the current 2-hour block. This makes the milk-round picker do the same,
-- and auto-clears stale "online" flags for partners with no active slot.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Milk-round driver must have an active booked delivery slot for now ──────────
create or replace function public._pick_milk_driver()
 returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid;
        v_date date := (now() at time zone 'Asia/Kolkata')::date;
        v_hour int  := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;
begin
  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl
       on sl.partner_id = pa.user_id
      and sl.slot_date = v_date
      and sl.start_hour = v_hour
      and sl.role in ('delivery', 'both')
      and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role in ('delivery', 'both')
    and pr.is_online = true
  order by pr.went_online_at asc nulls last
  limit 1;
  return v_uid;
end $$;

-- ── Clear stale online flags: a partner with no active slot for this 2-hour
--    block (and not mid-order) is no longer "online". Keeps the partner app
--    honest and stops any dispatch leaking to off-shift partners. ───────────────
create or replace function public._reset_stale_presence()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_date date := (now() at time zone 'Asia/Kolkata')::date;
        v_hour int  := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;
        v_n int;
begin
  with off as (
    update public.partner_presence pr set is_online = false
     where pr.is_online = true
       and pr.active_order_id is null
       and not exists (
         select 1 from public.partner_slots sl
          where sl.partner_id = pr.user_id
            and sl.slot_date = v_date
            and sl.start_hour = v_hour
            and sl.status <> 'cancelled')
     returning 1)
  select count(*) into v_n from off;
  return coalesce(v_n, 0);
end $$;

-- Fold the presence cleanup into the existing hourly sweep.
create or replace function public.run_subscriptions()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_made int := 0;
begin
  delete from public.orders o using public.subscriptions s
    where o.subscription_id = s.id and o.is_subscription and o.payment_status <> 'paid'
      and s.status = 'pending' and s.created_at < now() - interval '2 hours';
  delete from public.subscriptions
    where status = 'pending' and created_at < now() - interval '2 hours';

  perform public._reset_stale_presence();  -- drop off-shift partners offline first

  for r in select id from public.subscriptions where status = 'active' loop
    begin perform public.sub_generate_due(r.id); exception when others then null; end;
  end loop;
  v_made := public.sub_activate_due();
  perform public.activate_due_slot_orders();
  return v_made;
end; $$;

-- One-time cleanup of the flags that are already stale right now.
select public._reset_stale_presence() as cleared_now;
