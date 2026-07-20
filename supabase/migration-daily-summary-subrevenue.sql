-- ════════════════════════════════════════════════════════════════════════════
-- Nightly owner summary: recognise subscription revenue when the plan is bought.
-- A prepaid plan is paid in full up-front (the "master" order), so THAT is the
-- revenue — booked on the purchase day. The daily orders it later spawns are
-- fulfilment of money already collected and must NOT be counted as revenue again
-- (previously the master was excluded and the daily orders were counted, which
-- both mismatched the app and spread one sale across 30 days).
--   • Revenue + order count: include the master, exclude daily plan orders.
--   • Profit + top item: still from the daily fulfilment orders (they carry the
--     items + cost); the master has no line items so it never affects them.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.owner_daily_summary()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_orders  int := 0; v_revenue numeric := 0; v_profit numeric := 0;
  v_top text; v_top_qty int; v_low int := 0; v_out int := 0; v_body text;
begin
  -- Cash received today: normal orders + the prepaid plan master. Daily plan
  -- orders (subscription_id set, not the master) are excluded.
  select count(*), coalesce(sum(total), 0) into v_orders, v_revenue
  from public.orders
  where (created_at at time zone 'Asia/Kolkata')::date = v_today
    and status <> 'Cancelled'
    and not coalesce(is_return, false) and not coalesce(is_membership, false)
    and not coalesce(is_topup, false)
    and not (subscription_id is not null and not coalesce(is_subscription, false));

  -- Profit accrues as milk is delivered → from the daily fulfilment orders (and
  -- normal orders). The master has no order_items, so this join skips it.
  select coalesce(sum((oi.price - pc.cost) * oi.qty), 0) into v_profit
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.product_costs pc on pc.product_id = oi.product_id and pc.cost is not null
  where (o.created_at at time zone 'Asia/Kolkata')::date = v_today
    and o.status <> 'Cancelled'
    and not coalesce(o.is_return, false) and not coalesce(o.is_membership, false)
    and not coalesce(o.is_topup, false) and not coalesce(o.is_subscription, false);

  select oi.name, sum(oi.qty)::int into v_top, v_top_qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where (o.created_at at time zone 'Asia/Kolkata')::date = v_today
    and o.status <> 'Cancelled'
    and not coalesce(o.is_return, false) and not coalesce(o.is_membership, false)
    and not coalesce(o.is_topup, false) and not coalesce(o.is_subscription, false)
  group by oi.name order by sum(oi.qty) desc limit 1;

  select
    count(*) filter (where stock is not null and stock > 0
                       and stock <= (select low_stock_threshold from public.settings where id = 1)),
    count(*) filter (where stock is not null and stock = 0)
    into v_low, v_out from public.products;

  if v_orders = 0 then
    v_body := 'No orders today. ' || v_low || ' low, ' || v_out || ' out of stock.';
  else
    v_body := '₹' || round(v_revenue) || ' from ' || v_orders || ' order'
      || case when v_orders = 1 then '' else 's' end
      || ' · est. profit ₹' || round(v_profit);
    if v_top is not null then v_body := v_body || '. Top: ' || v_top || ' (' || v_top_qty || ')'; end if;
    if v_low > 0 or v_out > 0 then v_body := v_body || '. ' || v_low || ' low, ' || v_out || ' out of stock'; end if;
    v_body := v_body || '.';
  end if;

  perform public.notify_owner('📊 Aaj ka hisaab', v_body, 'daily_summary');
end; $function$;
