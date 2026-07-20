-- ════════════════════════════════════════════════════════════════════════════
-- Deep-audit fixes (backend).
--   1. cancel_subscription: FOR UPDATE (kills the concurrent double-refund race),
--      refund by days NOT delivered (not days_created — fixes the 1-day under-
--      refund), and restore stock on the cancelled scheduled orders.
--   2. discard_pending_subscription: scope the orders delete to the caller (IDOR).
--   3. sub_generate_due: per-plan advisory lock so a mark_order_paid/cron overlap
--      can never create a duplicate delivery / double-decrement stock.
--   4. owner_daily_summary: exclude is_subscription advance orders so a plan's
--      prepayment isn't double-counted with its daily delivery orders.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. cancel_subscription ───────────────────────────────────────────────────
create or replace function public.cancel_subscription(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_consumed int; v_left int; v_refund numeric;
begin
  -- FOR UPDATE serializes concurrent cancels: the 2nd caller blocks here, then
  -- re-reads status='cancelled' below and returns without a second refund.
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status in ('completed', 'cancelled') then return; end if;

  -- Give back the stock reserved by still-scheduled (undelivered) orders.
  update public.products pr set stock = pr.stock + agg.qty
    from (select oi.product_id, sum(oi.qty) qty
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where o.subscription_id = p_id and o.status = 'Scheduled'
          group by oi.product_id) agg
    where pr.id = agg.product_id and pr.stock is not null;
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and status = 'Scheduled';

  -- Refund every day NOT already delivered / in progress. Live (consumed) orders
  -- are anything past 'Scheduled' and not 'Cancelled'. This correctly refunds the
  -- day that was scheduled one-ahead but never delivered.
  select count(*) into v_consumed from public.orders
    where subscription_id = p_id and not coalesce(is_subscription, false)
      and status not in ('Scheduled', 'Cancelled');
  v_left := greatest(s.days_total - v_consumed, 0);
  v_refund := v_left * s.daily_total;

  update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_id;

  -- Only a paid (active) plan gets money back; pending (never-paid) plans don't.
  if s.status = 'active' and v_refund > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, v_refund, 'refund',
              'Subscription cancelled — ' || v_left || ' day(s) refunded', null, s.user_id);
  end if;
end; $function$;
revoke execute on function public.cancel_subscription(uuid) from public, anon;
grant execute on function public.cancel_subscription(uuid) to authenticated;

-- ── 2. discard_pending_subscription (scope orders delete to the caller) ──────
create or replace function public.discard_pending_subscription(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.orders
    where subscription_id = p_id and user_id = auth.uid()
      and is_subscription and payment_status <> 'paid';
  delete from public.subscriptions
    where id = p_id and user_id = auth.uid() and status = 'pending';
end; $function$;
revoke execute on function public.discard_pending_subscription(uuid) from public, anon;
grant execute on function public.discard_pending_subscription(uuid) to authenticated;

-- ── 3. sub_generate_due (advisory lock per plan) ─────────────────────────────
create or replace function public.sub_generate_due(p_plan uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_deliver date;
begin
  -- Serialize all generation for this plan (mark_order_paid + cron can overlap).
  perform pg_advisory_xact_lock(hashtextextended(p_plan::text, 4242));
  for i in 1..40 loop
    select * into s from public.subscriptions where id = p_plan;
    if s.id is null or s.status <> 'active' then return; end if;
    if s.days_done >= s.days_total then
      update public.subscriptions set status = 'completed', updated_at = now() where id = p_plan;
      return;
    end if;
    v_deliver := s.start_date + s.days_done;
    exit when v_today < v_deliver - 1;
    perform public._sub_create_order(s, v_deliver);
    update public.subscriptions
      set days_done = days_done + 1, last_delivery = v_deliver, updated_at = now()
      where id = p_plan;
  end loop;
  update public.subscriptions set status = 'completed', updated_at = now()
    where id = p_plan and days_done >= days_total and status = 'active';
end; $function$;
revoke execute on function public.sub_generate_due(uuid) from public, anon, authenticated;

-- ── 4. owner_daily_summary (don't double-count subscription prepayments) ─────
create or replace function public.owner_daily_summary()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_orders  int := 0; v_revenue numeric := 0; v_profit numeric := 0;
  v_top text; v_top_qty int; v_low int := 0; v_out int := 0; v_body text;
begin
  select count(*), coalesce(sum(total), 0) into v_orders, v_revenue
  from public.orders
  where (created_at at time zone 'Asia/Kolkata')::date = v_today
    and status <> 'Cancelled'
    and not coalesce(is_return, false) and not coalesce(is_membership, false)
    and not coalesce(is_topup, false) and not coalesce(is_subscription, false);

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
revoke execute on function public.owner_daily_summary() from public, anon, authenticated;
