-- ════════════════════════════════════════════════════════════════════════════
-- Subscriptions v2 — PREPAID plans.
--   Customer picks items + how many days, pays the whole plan upfront (Wallet or
--   Online). Deliveries start the NEXT day. Each day's order is created the day
--   before as a "Scheduled" order (no dispatch, no shop alarm) and flips to a
--   live "Placed" order on the delivery morning, entering normal fulfilment.
--   Free delivery on plans, so the prepaid amount = items × days.
--
-- Reuses the proven prepayment hub: the advance payment is an order flagged
-- is_subscription; when mark_order_paid confirms it (online), the plan activates
-- and the first day's order is created. Wallet plans activate instantly.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Order columns for subscriptions ──────────────────────────────────────────
alter table public.orders
  add column if not exists is_subscription boolean not null default false, -- the advance-payment order
  add column if not exists subscription_id uuid,                            -- links a daily order to its plan
  add column if not exists deliver_on date;                                 -- intended delivery date

-- ── Plans (prepaid) ──────────────────────────────────────────────────────────
drop table if exists public.subscriptions cascade;
create table public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  items         jsonb not null,               -- [{ id, qty, price }] locked at purchase
  address       text,
  location      jsonb,
  deliver_hour  int not null default 8,        -- IST hour deliveries go out
  days_total    int not null,                  -- days prepaid
  days_done     int not null default 0,        -- daily orders created so far
  daily_total   numeric not null,              -- locked per-day amount (items only)
  amount        numeric not null,              -- daily_total × days_total (prepaid)
  pay_method    text not null default 'wallet',-- 'wallet' | 'razorpay'
  status        text not null default 'pending', -- pending | active | completed | cancelled
  start_date    date,                          -- first delivery date (tomorrow of payment)
  last_delivery date,                          -- delivery date of the last order created
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index subs_active_idx on public.subscriptions (status) where status = 'active';
alter table public.subscriptions enable row level security;
create policy subs_own on public.subscriptions
  for select using (user_id = auth.uid());
revoke all on public.subscriptions from anon;

-- ── Keep next-day "Scheduled" orders (and the advance-pay order) out of the
--    dispatch + alarm path until they go live ──────────────────────────────────
create or replace function public.trg_dispatch()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- Scheduled = a subscription delivery for a future day; the advance-pay order
  -- is not a fulfilment order. Neither should dispatch on insert.
  if new.status = 'Scheduled' or coalesce(new.is_subscription, false) then
    return new;
  end if;
  begin perform public.dispatch_order(new.id); exception when others then null; end;
  return new;
end; $function$;

create or replace function public.trg_dispatch_update()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- Online payment: Awaiting payment → Placed dispatches the order.
  -- Subscription delivery day: Scheduled → Placed dispatches it the same way.
  if (old.status = 'Awaiting payment' or old.status = 'Scheduled') and new.status = 'Placed' then
    begin perform public.dispatch_order(new.id); exception when others then null; end;
    return new;
  end if;
  if new.rider_id is null
     and new.status in ('Placed', 'Packed')
     and coalesce(new.accepted, true) <> false
     and (new.status is distinct from old.status
          or new.picker_state is distinct from old.picker_state) then
    begin perform public.assign_waiting_delivery(new.id); exception when others then null; end;
  end if;
  return new;
end; $function$;

create or replace function public.notify_admin_new_order()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  -- Never ring the shop for non-fulfilment orders or for scheduled subscription
  -- deliveries (they alarm nothing; they go live quietly on their delivery day).
  if coalesce(NEW.is_return, false) or coalesce(NEW.is_membership, false)
     or coalesce(NEW.is_topup, false) or coalesce(NEW.is_subscription, false)
     or NEW.subscription_id is not null then
    return NEW;
  end if;
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('type','INSERT','record', to_jsonb(NEW))
  );
  return NEW;
end; $function$;

-- ── Create one prepaid "Scheduled" order for a plan's delivery date ──────────
create or replace function public._sub_create_order(p_plan public.subscriptions, p_deliver date)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_prof public.profiles; v_order public.orders; v_code text;
begin
  select * into v_prof from public.profiles where id = p_plan.user_id;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, delivery_fee, handling, surge_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, member_savings, subscription_id, deliver_on
  ) values (
    v_code, p_plan.user_id, v_prof.name, v_prof.phone, 'Scheduled', null, coalesce(v_prof.is_member,false),
    p_plan.daily_total, 0, 0, 0, 0, 0,
    0, 0, p_plan.daily_total, 0, 'subscription', 'paid',
    p_plan.address,
    case when p_plan.location is null then null else round((p_plan.location->>'distanceKm')::numeric, 2) end,
    p_plan.location, 0, p_plan.id, p_deliver
  ) returning * into v_order;

  insert into public.order_items (order_id, product_id, name, icon, qty, price)
    select v_order.id, (it->>'id'), p.name, p.icon, (it->>'qty')::int, (it->>'price')::numeric
    from jsonb_array_elements(p_plan.items) it
    join public.products p on p.id = (it->>'id');

  update public.products pr set stock = greatest(0, stock - (it->>'qty')::int)
    from jsonb_array_elements(p_plan.items) it
    where pr.id = (it->>'id') and pr.stock is not null;

  insert into public.notifications (user_id, title, body) values
    (p_plan.user_id, 'Kal ki delivery ready 🥛',
     'Subscription order ' || v_code || ' — delivery ' || to_char(p_deliver, 'DD Mon') || '. 🛵');
end; $function$;
revoke execute on function public._sub_create_order(public.subscriptions, date) from public, anon, authenticated;

-- ── Create any orders now due for a plan (one day before each delivery) ──────
create or replace function public.sub_generate_due(p_plan uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_deliver date;
begin
  for i in 1..40 loop
    select * into s from public.subscriptions where id = p_plan;
    if s.id is null or s.status <> 'active' then return; end if;
    if s.days_done >= s.days_total then
      update public.subscriptions set status = 'completed', updated_at = now() where id = p_plan;
      return;
    end if;
    v_deliver := s.start_date + s.days_done;          -- next delivery date
    exit when v_today < v_deliver - 1;                 -- not yet the day before
    perform public._sub_create_order(s, v_deliver);
    update public.subscriptions
      set days_done = days_done + 1, last_delivery = v_deliver, updated_at = now()
      where id = p_plan;
  end loop;
  -- mark complete if that was the last day
  update public.subscriptions set status = 'completed', updated_at = now()
    where id = p_plan and days_done >= days_total and status = 'active';
end; $function$;
revoke execute on function public.sub_generate_due(uuid) from public, anon, authenticated;

-- ── Flip due "Scheduled" subscription orders to live "Placed" ────────────────
create or replace function public.sub_activate_due()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_hour  int  := extract(hour from (now() at time zone 'Asia/Kolkata'))::int;
        v_n int;
begin
  with due as (
    update public.orders o set status = 'Placed'
    from public.subscriptions s
    where o.subscription_id = s.id
      and o.status = 'Scheduled'
      and o.deliver_on <= v_today
      and v_hour >= coalesce(s.deliver_hour, 8)
    returning o.id
  )
  select count(*) into v_n from due;
  return coalesce(v_n, 0);
end; $function$;
revoke execute on function public.sub_activate_due() from public, anon, authenticated;

-- ── Customer: buy a prepaid plan ─────────────────────────────────────────────
-- p_items: [{id, qty}] from the cart. Returns the advance-payment order.
create or replace function public.create_subscription_order(
  p_items jsonb, p_days int, p_hour int, p_address text, p_location jsonb, p_pay text)
 returns public.orders language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles;
  v_line jsonb; v_prod public.products; v_qty int; v_price numeric;
  v_locked jsonb := '[]'::jsonb; v_daily numeric := 0; v_amount numeric;
  v_days int := greatest(1, least(coalesce(p_days, 7), 30));
  v_hour int := greatest(0, least(coalesce(p_hour, 8), 23));
  v_pay text := lower(coalesce(p_pay, 'wallet'));
  v_plan public.subscriptions;
  v_order public.orders;
  v_code text;
  v_bal numeric;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Choose at least one item.'; end if;
  if v_pay not in ('wallet', 'razorpay') then v_pay := 'wallet'; end if;
  select * into v_prof from public.profiles where id = v_uid;

  -- Lock each item's price (standard price incl. any bulk break) for the plan.
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A chosen item is no longer available.'; end if;
    v_price := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_locked := v_locked || jsonb_build_object('id', v_prod.id, 'qty', v_qty, 'price', v_price);
    v_daily := v_daily + v_price * v_qty;
  end loop;
  if v_daily <= 0 then raise exception 'Choose at least one item.'; end if;
  v_amount := v_daily * v_days;

  insert into public.subscriptions (user_id, items, address, location, deliver_hour,
    days_total, daily_total, amount, pay_method, status)
    values (v_uid, v_locked, p_address, p_location, v_hour,
            v_days, v_daily, v_amount, v_pay, 'pending')
    returning * into v_plan;

  v_code := 'NGSSUB' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_subscription, subscription_id
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone,
    case when v_pay = 'wallet' then 'Subscription' else 'Awaiting payment' end,
    v_amount, v_amount, v_pay, case when v_pay = 'wallet' then 'paid' else 'pending' end,
    true, v_plan.id
  ) returning * into v_order;

  if v_pay = 'wallet' then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_amount then
      raise exception 'Your wallet has ₹% but the plan costs ₹%. Add money or pay online.',
        floor(v_bal)::text, floor(v_amount)::text;
    end if;
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_amount, 'spent', 'Subscription plan ' || v_code, v_order.id, v_uid);
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_plan.id;
    perform public.sub_generate_due(v_plan.id);
  end if;

  return v_order;
end; $function$;
revoke execute on function public.create_subscription_order(jsonb, int, int, text, jsonb, text) from public, anon;
grant execute on function public.create_subscription_order(jsonb, int, int, text, jsonb, text) to authenticated;

-- ── Customer: cancel a plan (refund the unused days to wallet) ───────────────
create or replace function public.cancel_subscription(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_left int; v_refund numeric;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid();
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status in ('completed', 'cancelled') then return; end if;
  -- Undelivered, still-scheduled days get refunded to the wallet.
  v_left := greatest(s.days_total - s.days_done, 0);
  v_refund := v_left * s.daily_total;
  -- Drop future scheduled orders that haven't gone live yet.
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and status = 'Scheduled';
  if v_refund > 0 and s.status = 'active' then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, v_refund, 'refund', 'Subscription cancelled — ' || v_left || ' day(s) refunded', null, s.user_id);
  end if;
  update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_id;
end; $function$;
revoke execute on function public.cancel_subscription(uuid) from public, anon;
grant execute on function public.cancel_subscription(uuid) to authenticated;

-- ── Hourly engine: create due orders + flip due deliveries live ──────────────
create or replace function public.run_subscriptions()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_made int := 0;
begin
  for r in select id from public.subscriptions where status = 'active' loop
    begin perform public.sub_generate_due(r.id); exception when others then null; end;
  end loop;
  v_made := public.sub_activate_due();
  return v_made;
end; $function$;
revoke execute on function public.run_subscriptions() from public, anon, authenticated;

select cron.unschedule('subscriptions') where exists (select 1 from cron.job where jobname='subscriptions');
select cron.schedule('subscriptions', '15 * * * *', 'select public.run_subscriptions()');
