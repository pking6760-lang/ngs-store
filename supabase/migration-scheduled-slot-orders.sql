-- ════════════════════════════════════════════════════════════════════════════
-- Hold future delivery-slot orders as SCHEDULED (not live), and make the
-- "delivered" grace period reliable.
--
-- Problem 1: picking a future window ("Tomorrow 10 AM–12 PM") only stamped a
-- label — the order still went out live (dispatched, partner + admin notified,
-- customer saw the live map). A future order must be HELD until its window.
--
-- Problem 2: the customer's live view is meant to linger a few minutes after
-- delivery, but ~half of delivered orders had no delivered_at, so the grace
-- period (which keys off delivered_at) never applied and the banner vanished.
--
-- Design: we do NOT touch _place_order_core (all the money math). Instead the
-- public place_order wrapper hands the schedule to a BEFORE INSERT trigger via
-- transaction-local settings; the trigger stamps status='Scheduled' + the
-- delivery date/hour AT INSERT, so the existing dispatch trigger (which already
-- skips 'Scheduled') never fires. An hourly job releases scheduled orders to
-- live when their window arrives — exactly how subscription orders already work.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. BEFORE INSERT: apply a pending schedule hint set by the place_order
--       wrapper. Only acts when the hint is present (normal/express orders and
--       subscription/return/topup inserts are untouched). ──────────────────────
create or replace function public._apply_slot_schedule()
 returns trigger language plpgsql set search_path to 'public' as $$
declare v_on text; v_hour text; v_slot text;
begin
  v_on := current_setting('ngs.sched_on', true);
  if v_on is null or v_on = '' then
    return new; -- no schedule hint → leave the order exactly as-is
  end if;
  -- Never reschedule subscription/plan orders (they manage their own status).
  if new.subscription_id is not null or coalesce(new.is_subscription, false) then
    return new;
  end if;
  -- Always record the chosen window.
  new.deliver_on := v_on::date;
  v_hour := current_setting('ngs.sched_hour', true);
  if v_hour is not null and v_hour <> '' then new.deliver_hour := v_hour::int; end if;
  v_slot := current_setting('ngs.sched_slot', true);
  if v_slot is not null and v_slot <> '' then new.delivery_slot := v_slot; end if;
  -- Hold as Scheduled ONLY when it isn't an unpaid online order. Scheduled
  -- orders are Pay-on-Delivery (the client enforces this) — this is a guard
  -- against ever creating a held, never-paid order.
  if new.status <> 'Awaiting payment' then
    new.status := 'Scheduled';
  end if;
  return new;
end $$;

drop trigger if exists apply_slot_schedule on public.orders;
create trigger apply_slot_schedule
  before insert on public.orders
  for each row execute function public._apply_slot_schedule();

-- ── 2. place_order wrapper: accept the delivery date + hour, set the hints,
--       call the (unchanged) core, then clear the hints. ────────────────────────
drop function if exists public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean, text);

create or replace function public.place_order(
  p_items          jsonb,
  p_coupon         text    default null,
  p_location       jsonb   default null,
  p_payment        text    default 'upi',
  p_address        text    default null,
  p_wallet         numeric default 0,
  p_redeem_points  integer default 0,
  p_membership     boolean default false,
  p_deliver_slot   text    default null,
  p_deliver_on     date    default null,
  p_deliver_hour   integer default null
) returns public.orders
  language plpgsql security definer set search_path to 'public'
as $$
declare v_order public.orders;
begin
  -- Future window → hand the schedule to the BEFORE INSERT trigger.
  if p_deliver_on is not null then
    perform set_config('ngs.sched_on',   p_deliver_on::text, true);
    perform set_config('ngs.sched_hour', coalesce(p_deliver_hour::text, ''), true);
    perform set_config('ngs.sched_slot', coalesce(p_deliver_slot, ''), true);
  end if;

  v_order := public._place_order_core(auth.uid(), p_items, p_coupon, p_location,
    p_payment, p_address, p_wallet, p_redeem_points, p_membership, true);

  -- Clear the hints so nothing else in this transaction inherits them.
  perform set_config('ngs.sched_on', '', true);

  -- Express order with a label but no schedule (shouldn't happen today, but be
  -- safe): stamp the label after the fact.
  if p_deliver_on is null and p_deliver_slot is not null and btrim(p_deliver_slot) <> '' then
    update public.orders set delivery_slot = p_deliver_slot where id = v_order.id;
    v_order.delivery_slot := p_deliver_slot;
  end if;

  return v_order;
end;
$$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean, text, date, integer)
  to authenticated;

-- ── 3. Admin alarm: never ring the shop for a held scheduled order (it goes
--       live quietly on its window). Adds a status='Scheduled' skip. ────────────
create or replace function public.notify_admin_new_order()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_secret text;
begin
  if coalesce(NEW.is_return, false) or coalesce(NEW.is_membership, false)
     or coalesce(NEW.is_topup, false) or coalesce(NEW.is_subscription, false)
     or NEW.subscription_id is not null or NEW.status = 'Scheduled' then
    return NEW;
  end if;
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('type','INSERT','record', to_jsonb(NEW))
  );
  return NEW;
end; $$;

-- ── 4. Release: flip plain scheduled orders (no subscription) to live once
--       their window has arrived. The Scheduled→Placed update fires the existing
--       dispatch-on-update trigger, which assigns a rider + pushes. ─────────────
create or replace function public.activate_due_slot_orders()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_hour  int  := extract(hour from (now() at time zone 'Asia/Kolkata'))::int;
        v_n int;
begin
  with due as (
    update public.orders set status = 'Placed'
     where status = 'Scheduled'
       and subscription_id is null
       and not coalesce(is_subscription, false)
       and deliver_on is not null
       and deliver_on <= v_today
       and v_hour >= coalesce(deliver_hour, 8)
     returning id
  )
  select count(*) into v_n from due;
  return coalesce(v_n, 0);
end $$;

-- Fold the release into the existing hourly subscription sweep.
create or replace function public.run_subscriptions()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_made int := 0;
begin
  delete from public.orders o using public.subscriptions s
    where o.subscription_id = s.id and o.is_subscription and o.payment_status <> 'paid'
      and s.status = 'pending' and s.created_at < now() - interval '2 hours';
  delete from public.subscriptions
    where status = 'pending' and created_at < now() - interval '2 hours';

  for r in select id from public.subscriptions where status = 'active' loop
    begin perform public.sub_generate_due(r.id); exception when others then null; end;
  end loop;
  v_made := public.sub_activate_due();
  perform public.activate_due_slot_orders();  -- release due one-off slot orders
  return v_made;
end; $$;

-- ── 5. Always stamp delivered_at when an order becomes Delivered, so the
--       customer's live view reliably lingers its grace period after delivery. ──
create or replace function public._stamp_delivered_at()
 returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'Delivered' and old.status is distinct from 'Delivered'
     and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end $$;

drop trigger if exists stamp_delivered_at on public.orders;
create trigger stamp_delivered_at
  before update on public.orders
  for each row execute function public._stamp_delivered_at();

-- Backfill delivered orders that never got a timestamp (use created_at as a
-- floor so they're treated as long-past, not "just delivered").
update public.orders set delivered_at = coalesce(packed_at, created_at)
 where status = 'Delivered' and delivered_at is null;

select 'scheduled slot orders + delivered grace ready' as status;
