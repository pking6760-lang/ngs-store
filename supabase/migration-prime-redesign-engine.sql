-- NGS Prime redesign — the value-pool engine.
-- The ₹99 is returned to the member as: always-free delivery (near+mid, done in
-- _place_order_core), 5% wallet cashback, and a ₹99 value guarantee. This file
-- adds the config dials, the cashback job, and the guarantee settle.

-- 1) Config dials on settings.rewards.membership (merge, keep existing keys).
update public.settings set rewards = jsonb_set(
  rewards, '{membership}',
  coalesce(rewards->'membership', '{}'::jsonb) || jsonb_build_object(
    'cashbackPct',      5,     -- % of item value returned to the wallet
    'cashbackCap',      150,   -- max cashback per rolling 30 days (₹)
    'cashbackMinOrder', 99,    -- order must clear this to earn cashback (anti-farm)
    'guaranteeFloor',   99,    -- save at least this or we top up the difference
    'farFee',           25     -- reduced delivery fee for members in the far zone
  ))
where id = 1;

-- 2) Bookkeeping columns.
alter table public.orders   add column if not exists prime_cashback numeric;              -- null = not processed by cashback job
alter table public.profiles add column if not exists member_period_start timestamptz;     -- start of the current 30-day guarantee window
alter table public.profiles add column if not exists member_guarantee_at timestamptz;     -- last period settled (double-pay guard)

-- Don't retro-cashback orders that predate the redesign: mark existing delivered
-- member orders as already processed (₹0). Only new deliveries earn cashback.
update public.orders set prime_cashback = 0
  where member = true and status = 'Delivered' and prime_cashback is null;

-- Give current members a period start so the guarantee has a window to measure.
update public.profiles
  set member_period_start = coalesce(member_period_start, greatest(coalesce(member_since, now()), member_until - interval '30 days'))
  where is_member = true and member_until is not null;

-- 3) Each activation opens a fresh guarantee window.
create or replace function public._activate_membership(p_uid uuid, p_days integer)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.profiles
     set is_member = true,
         member_until = greatest(coalesce(member_until, now()), now()) + make_interval(days => p_days),
         member_since = coalesce(member_since, now()),
         member_period_start = now(),
         member_order_count = 0,
         membership_count = coalesce(membership_count, 0) + 1
   where id = p_uid;
$function$;

-- 4) Prime cashback: 5% of item value to the wallet on each DELIVERED member
-- order (cancellation-safe — cancelled orders never deliver), above the min, up
-- to the rolling-30-day cap. Idempotent: prime_cashback flips from null once done.
create or replace function public.run_prime_cashback()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cfg jsonb; v_pct numeric; v_cap numeric; v_min numeric;
        r record; v_amt numeric; v_given numeric; v_n int := 0;
begin
  v_cfg := coalesce((select rewards->'membership' from public.settings where id = 1), '{}'::jsonb);
  v_pct := coalesce((v_cfg->>'cashbackPct')::numeric, 5);
  v_cap := coalesce((v_cfg->>'cashbackCap')::numeric, 150);
  v_min := coalesce((v_cfg->>'cashbackMinOrder')::numeric, 99);
  if v_pct <= 0 then return 0; end if;

  for r in
    select id, user_id, item_total, human_code from public.orders
    where member = true and status = 'Delivered' and prime_cashback is null
    order by coalesce(delivered_at, created_at)
    limit 300
  loop
    if coalesce(r.item_total, 0) < v_min then
      update public.orders set prime_cashback = 0 where id = r.id;   -- processed, earned nothing
      continue;
    end if;
    v_amt := round(r.item_total * v_pct / 100.0);
    select coalesce(sum(amount), 0) into v_given from public.customer_wallet
      where user_id = r.user_id and kind = 'cashback' and created_at > now() - interval '30 days';
    v_amt := least(v_amt, greatest(0, v_cap - v_given));

    if v_amt > 0 then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (r.user_id, v_amt, 'cashback', 'Prime cashback — ' || r.human_code, r.id, r.user_id);
      insert into public.notifications (user_id, title, body) values
        (r.user_id, 'Prime cashback added',
         '₹' || floor(v_amt)::text || ' cashback is in your NGS Wallet for order ' || r.human_code || '.');
    end if;
    update public.orders set prime_cashback = v_amt where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $function$;

-- 5) The ₹99 value guarantee: when a member's 30-day window closes without
-- renewal, sum what they saved (member prices + free delivery + cashback). If it
-- fell short of the floor, credit the gap. Settles once per window.
create or replace function public.run_prime_guarantee()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_floor numeric; v_fee numeric; v_free_above numeric;
        r record; v_saved numeric; v_cash numeric; v_gap numeric; v_n int := 0;
begin
  v_floor := coalesce((select (rewards->'membership'->>'guaranteeFloor')::numeric from public.settings where id = 1), 99);
  select coalesce(delivery_fee, 0), coalesce(free_delivery_above, 0)
    into v_fee, v_free_above from public.settings where id = 1;
  if v_floor <= 0 then return 0; end if;

  for r in
    select id, member_period_start, member_until from public.profiles
    where member_period_start is not null
      and member_until is not null and member_until <= now()
      and (member_guarantee_at is null or member_guarantee_at < member_period_start)
    limit 200
  loop
    select coalesce(sum(member_savings), 0)
         + coalesce(sum(case when coalesce(delivery_fee, 0) = 0 and item_total < v_free_above then v_fee else 0 end), 0)
      into v_saved
      from public.orders
      where user_id = r.id and member = true and coalesce(status, '') <> 'Cancelled'
        and created_at >= r.member_period_start and created_at <= r.member_until;

    select coalesce(sum(amount), 0) into v_cash from public.customer_wallet
      where user_id = r.id and kind = 'cashback'
        and created_at >= r.member_period_start and created_at <= r.member_until;

    v_saved := v_saved + v_cash;
    v_gap := v_floor - v_saved;

    if v_gap > 0 then
      insert into public.customer_wallet (user_id, amount, kind, note, created_by)
        values (r.id, round(v_gap), 'adjustment', 'NGS Prime — ₹99 value guarantee top-up', r.id);
      insert into public.notifications (user_id, title, body) values
        (r.id, 'Your ₹99 back, guaranteed',
         'Your Prime savings came to ₹' || floor(v_saved)::text || ' this month, so we topped up ₹'
         || floor(v_gap)::text || ' to your NGS Wallet. That''s the NGS Prime promise.');
      v_n := v_n + 1;
    end if;
    update public.profiles set member_guarantee_at = now() where id = r.id;
  end loop;
  return v_n;
end; $function$;

-- 6) Show cashback in the member's savings tally.
create or replace function public.my_prime_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_fee numeric; v_free_above numeric;
  v_orders int; v_product numeric; v_delivery numeric; v_cash numeric;
  v_since timestamptz; v_until timestamptz; v_code text; v_member boolean;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;

  select coalesce(delivery_fee, 0), coalesce(free_delivery_above, 0)
    into v_fee, v_free_above from public.settings where id = 1;
  select is_member, member_since, member_until, customer_code
    into v_member, v_since, v_until, v_code
    from public.profiles where id = v_uid;

  select
    count(*),
    coalesce(sum(member_savings), 0),
    coalesce(sum(case when coalesce(delivery_fee, 0) = 0 and item_total < v_free_above then v_fee else 0 end), 0)
  into v_orders, v_product, v_delivery
  from public.orders
  where user_id = v_uid and member = true and coalesce(status, '') <> 'Cancelled';

  select coalesce(sum(amount), 0) into v_cash
    from public.customer_wallet where user_id = v_uid and kind = 'cashback';

  return jsonb_build_object(
    'memberOrders',    v_orders,
    'productSaved',    round(v_product),
    'deliverySaved',   round(v_delivery),
    'cashbackEarned',  round(v_cash),
    'lifetimeSavings', round(v_product + v_delivery + v_cash),
    'memberSince',     v_since,
    'memberUntil',     v_until,
    'code',            v_code,
    'isMember',        coalesce(v_member, false)
  );
end; $function$;

-- 7) Schedule the two jobs (idempotent unschedule-then-schedule).
select cron.unschedule('ngs-prime-cashback')  where exists (select 1 from cron.job where jobname = 'ngs-prime-cashback');
select cron.unschedule('ngs-prime-guarantee') where exists (select 1 from cron.job where jobname = 'ngs-prime-guarantee');
select cron.schedule('ngs-prime-cashback',  '*/30 * * * *', 'select public.run_prime_cashback();');
select cron.schedule('ngs-prime-guarantee', '20 1 * * *',   'select public.run_prime_guarantee();');
