-- ════════════════════════════════════════════════════════════════════════════
-- Owner automations #1 & #2 — a shop that reports to its owner.
--   1. Nightly business summary  → one quiet push at ~9:30pm IST with today's
--      orders, revenue, estimated profit, top seller and stock health.
--   2. Low-stock alerts          → a midday digest of items running low / out,
--      plus auto-hide of anything that hits zero stock (auto-unhide on restock).
-- Delivery: notify_owner() pokes the notify-owner Edge Function, which sends a
-- QUIET tray push (type owner_alert) to every admin device — NOT the order siren.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Poke → notify-owner Edge Function (shared webhook secret) ────────────────
create or replace function public.notify_owner(p_title text, p_body text, p_tag text default 'owner')
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-owner',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('title', p_title, 'body', coalesce(p_body,''), 'tag', coalesce(p_tag,'owner'))
  );
exception when others then null;   -- never let a failed push break the caller
end; $function$;
revoke execute on function public.notify_owner(text, text, text) from public, anon, authenticated;

-- ── #1 Nightly business summary ─────────────────────────────────────────────
create or replace function public.owner_daily_summary()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_orders  int := 0;
  v_revenue numeric := 0;
  v_profit  numeric := 0;
  v_top     text;
  v_top_qty int;
  v_low     int := 0;
  v_out     int := 0;
  v_body    text;
begin
  -- Fulfilment orders placed today (IST). Memberships / top-ups / returns and
  -- cancellations are not sales.
  select count(*), coalesce(sum(total), 0)
    into v_orders, v_revenue
  from public.orders
  where (created_at at time zone 'Asia/Kolkata')::date = v_today
    and status <> 'Cancelled'
    and not coalesce(is_return, false)
    and not coalesce(is_membership, false)
    and not coalesce(is_topup, false);

  -- Estimated profit: (sell − cost) × qty over today's items that have a known
  -- buying price. Items with no cost recorded are simply left out of the number.
  select coalesce(sum((oi.price - pc.cost) * oi.qty), 0)
    into v_profit
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.product_costs pc on pc.product_id = oi.product_id and pc.cost is not null
  where (o.created_at at time zone 'Asia/Kolkata')::date = v_today
    and o.status <> 'Cancelled'
    and not coalesce(o.is_return, false)
    and not coalesce(o.is_membership, false)
    and not coalesce(o.is_topup, false);

  -- Best seller today (by units).
  select oi.name, sum(oi.qty)::int
    into v_top, v_top_qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where (o.created_at at time zone 'Asia/Kolkata')::date = v_today
    and o.status <> 'Cancelled'
    and not coalesce(o.is_return, false)
    and not coalesce(o.is_membership, false)
    and not coalesce(o.is_topup, false)
  group by oi.name
  order by sum(oi.qty) desc
  limit 1;

  -- Stock health right now.
  select
    count(*) filter (where stock is not null and stock > 0
                       and stock <= (select low_stock_threshold from public.settings where id = 1)),
    count(*) filter (where stock is not null and stock = 0)
    into v_low, v_out
  from public.products;

  if v_orders = 0 then
    v_body := 'No orders today. ' || v_low || ' low, ' || v_out || ' out of stock.';
  else
    v_body := '₹' || round(v_revenue) || ' from ' || v_orders || ' order'
      || case when v_orders = 1 then '' else 's' end
      || ' · est. profit ₹' || round(v_profit);
    if v_top is not null then
      v_body := v_body || '. Top: ' || v_top || ' (' || v_top_qty || ')';
    end if;
    if v_low > 0 or v_out > 0 then
      v_body := v_body || '. ' || v_low || ' low, ' || v_out || ' out of stock';
    end if;
    v_body := v_body || '.';
  end if;

  perform public.notify_owner('📊 Aaj ka hisaab', v_body, 'daily_summary');
end; $function$;
revoke execute on function public.owner_daily_summary() from public, anon, authenticated;

-- ── #2 Low-stock digest (midday) ────────────────────────────────────────────
create or replace function public.owner_low_stock_check()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_thr   int := (select low_stock_threshold from public.settings where id = 1);
  v_low   int;
  v_out   int;
  v_names text;
  v_body  text;
begin
  select count(*) filter (where stock > 0 and stock <= v_thr),
         count(*) filter (where stock = 0)
    into v_low, v_out
  from public.products
  where stock is not null and stock <= v_thr;

  if coalesce(v_low, 0) = 0 and coalesce(v_out, 0) = 0 then
    return;   -- nothing to report → stay quiet
  end if;

  -- A few example names so the owner knows what to grab, worst first.
  select string_agg(name, ', ')
    into v_names
  from (
    select name from public.products
    where stock is not null and stock <= v_thr
    order by stock asc, name asc
    limit 6
  ) t;

  v_body := v_out || ' out of stock, ' || v_low || ' running low.';
  if v_names is not null then
    v_body := v_body || ' ' || v_names || '.';
  end if;

  perform public.notify_owner('📦 Restock karo', v_body, 'low_stock');
end; $function$;
revoke execute on function public.owner_low_stock_check() from public, anon, authenticated;

-- ── #2b Auto-hide at zero stock (and auto-unhide on restock) ─────────────────
-- Only reacts to a real change in the stock number, so it never fights the owner
-- manually toggling `active` on an in-stock item.
create or replace function public._auto_toggle_on_stock()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.stock is distinct from old.stock and new.stock is not null then
    if new.stock = 0 and new.active then
      new.active := false;                       -- sold out → off the storefront
    elsif old.stock = 0 and new.stock > 0 and not new.active then
      new.active := true;                        -- restocked → back on
    end if;
  end if;
  return new;
end; $function$;

drop trigger if exists trg_auto_toggle_on_stock on public.products;
create trigger trg_auto_toggle_on_stock
  before update of stock on public.products
  for each row execute function public._auto_toggle_on_stock();

-- ── Schedules (times in UTC; comments show IST) ─────────────────────────────
-- Nightly summary: 16:00 UTC = 21:30 IST.
select cron.unschedule('owner-daily-summary') where exists (select 1 from cron.job where jobname='owner-daily-summary');
select cron.schedule('owner-daily-summary', '0 16 * * *', 'select public.owner_daily_summary()');
-- Low-stock digest: 05:30 UTC = 11:00 IST.
select cron.unschedule('owner-low-stock') where exists (select 1 from cron.job where jobname='owner-low-stock');
select cron.schedule('owner-low-stock', '30 5 * * *', 'select public.owner_low_stock_check()');
