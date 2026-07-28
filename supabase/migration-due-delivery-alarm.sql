-- Ring the shop before a scheduled delivery is due — when it's the owner's job.
--
-- THE BUG
--
-- A daily subscription delivery has never rung the admin alarm. Not once in
-- nine days of the owner's 30-day test. The reason is structural, not a typo:
--
--   * notify_admin_new_order() is the ONLY thing that rings the alarm, and it
--     is an AFTER INSERT trigger.
--   * It returns early when subscription_id is not null OR status='Scheduled'.
--   * A daily delivery is INSERTed at midnight IST as Scheduled with a
--     subscription_id, so it trips both exits — correctly. Nobody wants a siren
--     at 00:00 for tomorrow's milk.
--   * It then goes live at 08:00 by an UPDATE, and there is no admin-alarm
--     trigger on UPDATE at all.
--
-- So the alarm is suppressed at night and never re-armed for the morning. The
-- same hole swallowed NGS1534, an ordinary customer-scheduled "Tomorrow 10 AM"
-- order: inserted Scheduled, flipped by cron, never rang.
--
-- And needs_owner — the flag that already means "no partner took this, it's
-- yours" — is set in five places and pushes nothing, anywhere. The owner's last
-- six milk rounds all carry needs_owner = true. Silently.
--
-- THE TRAP IN THE OBVIOUS FIX
--
-- Ringing 15 minutes early means going live 15 minutes early, and both
-- pick_partner() and _pick_milk_driver() derive the roster slot from now():
-- (hour/2)*2. Activate an 8 AM round at 07:45 and they query the 6–8 AM slot,
-- miss the driver rostered 8–10, and hand the round to the owner AS "no staff
-- available" — manufacturing the exact condition the alarm reports. Both are
-- changed here to ask about the hour the delivery is FOR, not the hour it
-- happens to be.
--
-- WHAT RINGS, AND WHEN
--
--   T-15  no rider assigned at all        -> ring: it's yours, start now
--   T-0   assigned but never accepted     -> ring: he ignored it, it's yours
--   ever  already accepted by a partner   -> silence. Staff have it.
--
-- At most ONE alarm per order, ever, claimed atomically through
-- orders.owner_alarm_at so two overlapping cron runs cannot double-ring. A
-- whole subscription round is one job and therefore one alarm, not one per
-- customer. Nothing rings more than 90 minutes past its slot: after that a
-- siren is not an alarm, it is history, and it would go off at midnight.

begin;

-- How much warning the owner wants. His words: 8 AM delivery, 7:45 alarm.
alter table public.ops_config
  add column if not exists prep_lead_minutes int not null default 15;

comment on column public.ops_config.prep_lead_minutes is
  'Minutes before a scheduled delivery slot that the order goes live and the owner is alarmed if no partner has it. 15 = an 8:00 AM delivery wakes the shop at 7:45.';

-- One alarm per order, ever. Also the claim token that makes the sweep safe to
-- run every minute from more than one place at once.
alter table public.orders
  add column if not exists owner_alarm_at timestamptz;

comment on column public.orders.owner_alarm_at is
  'When the owner was alarmed that this scheduled delivery is his. Set once, never cleared -- it is what stops the siren repeating every minute.';

create index if not exists idx_orders_due_alarm
  on public.orders (deliver_on)
  where deliver_on is not null and owner_alarm_at is null;

-- Every scheduled delivery up to and including today is history. Stamp those so
-- switching this on does not set off nine days of backdated alarms at once.
--
-- ONLY those. Stamping the whole column would also stamp tomorrow's order,
-- which is still Scheduled and has not had its morning yet -- and the stamp is
-- permanent, so it would silently swallow the very first real alarm. Caught
-- because tomorrow's NGS6985 came back marked before it had ever rung.
update public.orders
   set owner_alarm_at = now()
 where deliver_on is not null
   and owner_alarm_at is null
   and deliver_on <= (now() at time zone 'Asia/Kolkata')::date;

-- The exact instant a slot begins, in real time. deliver_on/deliver_hour are a
-- local date and a local hour; everything else in the system is timestamptz.
-- STABLE, not IMMUTABLE: a named time zone is data, and Postgres treats the
-- conversion as stable. Claiming otherwise would be a lie the planner believes.
create or replace function public._slot_start(p_on date, p_hour int)
returns timestamptz
language sql stable set search_path to 'public'
as $$
  select ((p_on + make_interval(hours => coalesce(p_hour, 8))) at time zone 'Asia/Kolkata');
$$;

-- ---------------------------------------------------------------------------
-- Roster lookup: ask about the hour the delivery is FOR.
-- ---------------------------------------------------------------------------

-- Adding a defaulted argument to an existing function creates an overload, and
-- then every existing no-argument call is ambiguous. Drop first.
drop function if exists public._pick_milk_driver();

create or replace function public._pick_milk_driver(p_hour int default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid;
        v_date date := (now() at time zone 'Asia/Kolkata')::date;
        -- The round is delivered at p_hour, so the driver we want is the one
        -- rostered for p_hour's slot -- not for the slot we are standing in
        -- while we prepare it 15 minutes early.
        v_hour int  := (coalesce(p_hour, extract(hour from now() at time zone 'Asia/Kolkata')::int) / 2) * 2;
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

-- Same correction for ordinary orders, but self-contained: the order already
-- knows the hour it is promised for, so no caller has to be changed and no
-- signature moves. An instant order has no deliver_on and behaves exactly as
-- before.
create or replace function public.pick_partner(p_role text, p_order uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.ops_config; v_total numeric; v_cod boolean; v_hour int; v_date date;
        v_uid uuid; v_tried uuid[]; v_shop_lat numeric; v_shop_lng numeric;
        v_on date; v_dh int;
begin
  select * into cfg from public.ops_config where id = 1;
  select total, lower(coalesce(payment_method, '')) = 'cod', coalesce(dispatch_tried,'{}'),
         deliver_on, deliver_hour
    into v_total, v_cod, v_tried, v_on, v_dh
    from public.orders where id = p_order;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  -- A promised slot that has not started yet decides the roster; otherwise the
  -- clock does. Prevents a 9:45 dispatch of a 10 AM order from hunting for
  -- partners in the 8–10 slot.
  v_hour := case
    when v_on = v_date and v_dh is not null and now() < public._slot_start(v_on, v_dh)
      then (v_dh / 2) * 2
    else (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2
  end;

  select (shop_locations->0->>'lat')::numeric, (shop_locations->0->>'lng')::numeric
    into v_shop_lat, v_shop_lng from public.settings where id = 1;

  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl on sl.partner_id = pa.user_id
       and sl.slot_date = v_date and sl.start_hour = v_hour and sl.role = p_role and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role = p_role
    and pr.is_online = true and pr.active_order_id is null
    and pa.user_id <> all(v_tried)
    and (p_role <> 'delivery' or not v_cod or (public.partner_cash_in_hand(pa.user_id) + v_total) <= cfg.rider_cash_cap)
  order by
    case when v_shop_lat is not null and pr.lat is not null
              and pr.loc_at > now() - interval '5 minutes' then 0 else 1 end asc,
    case when v_shop_lat is not null and pr.lat is not null
              and pr.loc_at > now() - interval '5 minutes'
         then (pr.lat - v_shop_lat) * (pr.lat - v_shop_lat)
            + (pr.lng - v_shop_lng) * (pr.lng - v_shop_lng)
         else null end asc nulls last,
    pr.went_online_at asc nulls last
  limit 1
  for update of pr skip locked;
  return v_uid;
end $$;

-- The milk round asks for the driver rostered at the round's own hour.
create or replace function public.dispatch_milk_round()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.ops_config; v_driver uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_first uuid; v_n int; v_hour int;
begin
  select * into cfg from public.ops_config where id = 1;
  select count(*), min(coalesce(deliver_hour, 8)) into v_n, v_hour from public.orders
    where subscription_id is not null and not coalesce(is_subscription,false)
      and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
      and deliver_on = v_today;
  if coalesce(v_n,0) = 0 then return; end if;
  select id into v_first from public.orders
    where subscription_id is not null and not coalesce(is_subscription,false)
      and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
      and deliver_on = v_today
    order by human_code limit 1;

  if cfg.coverage_delivery = 'staff' then
    v_driver := public._pick_milk_driver(v_hour);
  end if;

  if v_driver is not null then
    update public.orders
      set rider_id = v_driver, delivery_state = 'assigned', rider_assigned_at = now(), needs_owner = false
      where subscription_id is not null and not coalesce(is_subscription,false)
        and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
        and deliver_on = v_today;
    begin perform public._notify_partner(v_driver, 'delivery', v_first); exception when others then null; end;
  else
    update public.orders set needs_owner = true
      where subscription_id is not null and not coalesce(is_subscription,false)
        and status = 'Placed' and rider_id is null and delivery_state = 'unassigned'
        and deliver_on = v_today;
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- Go live prep_lead_minutes before the slot, not on the hour.
-- ---------------------------------------------------------------------------

create or replace function public.sub_activate_due()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_lead interval;
        v_n int;
begin
  select make_interval(mins => coalesce(prep_lead_minutes, 15)) into v_lead
    from public.ops_config where id = 1;
  v_lead := coalesce(v_lead, interval '15 minutes');
  with due as (
    update public.orders o set status = 'Placed'
    from public.subscriptions s
    where o.subscription_id = s.id
      and o.status = 'Scheduled'
      and o.deliver_on <= v_today
      -- Whole-hour comparison could only ever fire at 08:00. A real instant can
      -- fire at 07:45.
      and now() >= public._slot_start(o.deliver_on, coalesce(o.deliver_hour, s.deliver_hour, 8)) - v_lead
    returning o.id
  )
  select count(*) into v_n from due;
  if coalesce(v_n,0) > 0 then
    perform public.dispatch_milk_round();
  end if;
  return coalesce(v_n, 0);
end; $$;

create or replace function public.activate_due_slot_orders()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_lead interval;
        v_n int;
begin
  select make_interval(mins => coalesce(prep_lead_minutes, 15)) into v_lead
    from public.ops_config where id = 1;
  v_lead := coalesce(v_lead, interval '15 minutes');
  with due as (
    update public.orders set status = 'Placed'
     where status = 'Scheduled'
       and subscription_id is null
       and not coalesce(is_subscription, false)
       and deliver_on is not null
       and deliver_on <= v_today
       and now() >= public._slot_start(deliver_on, coalesce(deliver_hour, 8)) - v_lead
     returning id
  )
  select count(*) into v_n from due;
  return coalesce(v_n, 0);
end $$;

-- ---------------------------------------------------------------------------
-- The alarm itself.
-- ---------------------------------------------------------------------------

create or replace function public.ring_owner_due_deliveries()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.ops_config; v_lead interval; v_secret text;
        v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_url text := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin';
        r record; v_n int := 0; v_when text; v_title text; v_body text;
begin
  select * into cfg from public.ops_config where id = 1;
  v_lead := make_interval(mins => coalesce(cfg.prep_lead_minutes, 15));
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  -- No secret means the endpoint would reject us anyway. Fail quiet, not loud.
  if v_secret is null or v_secret = '' then return 0; end if;

  -- Claim and read in ONE statement. The UPDATE is the subquery's own source, so
  -- two overlapping runs cannot both win a row, and if this transaction rolls
  -- back the claim and the push disappear together. (A temp table here would
  -- collide with itself the moment anything called this twice in a transaction.)
  for r in
    with claimed as (
      update public.orders o
         set owner_alarm_at = now(), needs_owner = true
       where o.owner_alarm_at is null
         and o.id in (
           select x.id from public.orders x
            where x.deliver_on = v_today
              and x.owner_alarm_at is null
              and x.status in ('Placed', 'Packed')
              and not coalesce(x.is_membership, false)
              and not coalesce(x.is_topup, false)
              and not coalesce(x.is_return, false)
              -- Past this a siren is not an alarm, it is history — and it would
              -- go off at odd hours for something nobody can still fix.
              and now() < public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8)) + interval '90 minutes'
              and (
                -- T-15: nobody has it at all.
                (x.rider_id is null
                 and now() >= public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8)) - v_lead)
                -- T-0: someone was given it and never accepted, so in practice
                -- nobody has it and the owner is about to be late.
                or (coalesce(x.delivery_state, 'unassigned') <> 'accepted'
                    and now() >= public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8)))
              ))
      returning o.id, o.human_code, o.total, o.customer_name, o.payment_method,
                coalesce(o.deliver_hour, 8) as dh,
                (o.subscription_id is not null and not coalesce(o.is_subscription, false)) as is_daily
    )
    -- A subscription round is ONE job, so it is one alarm for the lot, not one
    -- siren per house. Every other scheduled order is its own trip.
    select c.is_daily, c.dh,
           count(*)::int                                       as cnt,
           sum(c.total)                                        as amount,
           sum(case when lower(coalesce(c.payment_method,'')) = 'cod'
                    then c.total else 0 end)                   as cash,
           min(c.human_code)                                   as human_code,
           min(c.customer_name)                                as customer_name,
           min(lower(coalesce(c.payment_method,'')))           as pay
      from claimed c
     group by c.is_daily, c.dh, case when c.is_daily then null else c.id::text end
     order by c.dh
  loop
    v_when := to_char(public._slot_start(v_today, r.dh) at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
    if r.is_daily then
      v_title := '🥛 Daily delivery — ' || v_when;
      v_body  := r.cnt || case when r.cnt = 1 then ' delivery' else ' deliveries' end
                 || ' · ₹' || trim(to_char(coalesce(r.amount,0), 'FM999999990.00'))
                 || case when coalesce(r.cash,0) > 0
                         then ' · 💵 collect ₹' || trim(to_char(r.cash, 'FM999999990.00')) else '' end
                 || ' · no rider — it''s yours';
    else
      v_title := '⏰ Scheduled order — ' || v_when;
      v_body  := coalesce(r.human_code, '') || ' · ' || coalesce(r.customer_name, 'A customer')
                 || ' · ₹' || trim(to_char(coalesce(r.amount,0), 'FM999999990.00'))
                 || case when r.pay = 'cod' then ' · 💵 collect cash' else ' · ✅ paid' end
                 || ' · no rider — it''s yours';
    end if;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
      body := jsonb_build_object('type','DUE','title', v_title, 'body', v_body,
                                 'record', jsonb_build_object('human_code',
                                   case when r.is_daily then 'daily' else r.human_code end)));
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;

-- Cron runs as the table owner. Nothing on the client may set off the siren.
revoke all on function public.ring_owner_due_deliveries() from public;
revoke all on function public._slot_start(date, int) from public;
revoke all on function public._pick_milk_driver(int) from public;

-- Every minute, right after the activation pass — so a round that just went
-- live has already had its chance to find a driver before we decide nobody has it.
create or replace function public.release_due_orders()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_sub int := 0; v_slot int := 0;
begin
  begin v_sub  := coalesce(public.sub_activate_due(), 0);         exception when others then v_sub  := 0; end;
  begin v_slot := coalesce(public.activate_due_slot_orders(), 0); exception when others then v_slot := 0; end;
  begin perform public.ring_owner_due_deliveries();               exception when others then null;      end;
  return v_sub + v_slot;
end; $$;

commit;
