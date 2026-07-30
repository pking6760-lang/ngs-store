-- UPI Autopay — Phase 8: refund an already-CHARGED-but-UNDELIVERED day on skip /
-- cancel, and refund a charge that captures after the plan is cancelled.
--
-- For upi_autopay the daily delivery order is created only AFTER the bank debit
-- captures, with wallet_used=0 (the money came from the bank, not the wallet).
-- The generic cancel/skip paths cancel that 'Scheduled' order but — because
-- wallet_used=0 — the wallet_restore trigger refunds nothing, so the customer
-- lost the money for an undelivered day. Three fixes:
--   1. cancel_subscription: refund the value of any Scheduled (captured) upi day.
--   2. skip_next_delivery: refund the captured upi day, and do NOT rewind
--      days_done for upi (pay-per-delivery skips forward, it doesn't "make up").
--   3. sub_upi_settle_success: if the plan is no longer active when the debit
--      captures (cancelled between charge and capture), refund instead of
--      silently keeping the money with no delivery.

begin;

-- ── 1. cancel_subscription: refund captured-but-undelivered upi days ───────────
create or replace function public.cancel_subscription(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  s public.subscriptions; v_consumed int; v_left int; v_refund numeric;
  v_bal numeric; v_reclaim numeric; v_upi_refund numeric := 0;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status in ('completed', 'cancelled') then return; end if;

  update public.products pr set stock = pr.stock + agg.qty
    from (select oi.product_id, sum(oi.qty) qty
          from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.subscription_id = p_id and o.status = 'Scheduled'
          group by oi.product_id) agg
    where pr.id = agg.product_id and pr.stock is not null;

  -- Capture the value of already-charged (bank-paid, wallet_used=0) upi days that
  -- are still Scheduled, BEFORE we cancel them — these need an explicit refund.
  if s.pay_method = 'upi_autopay' then
    select coalesce(sum(total), 0) into v_upi_refund from public.orders
      where subscription_id = p_id and status = 'Scheduled'
        and payment_method = 'subscription' and payment_status = 'paid' and coalesce(wallet_used, 0) = 0;
  end if;

  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and status = 'Scheduled';

  select count(*) into v_consumed from public.orders
    where subscription_id = p_id and not coalesce(is_subscription, false)
      and status not in ('Scheduled', 'Cancelled');
  v_left := greatest(s.days_total - v_consumed, 0);
  v_refund := v_left * s.daily_total;

  update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_id;

  if s.status = 'active' and s.pay_method in ('wallet', 'razorpay') and v_refund > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, v_refund, 'refund',
              'Subscription cancelled — ' || v_left || ' day(s) refunded', null, s.user_id);
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Subscription cancelled',
       'Your plan is cancelled. ₹' || floor(v_refund)::text
       || ' for ' || v_left || ' unused day(s) is back in your NGS Wallet.');

  elsif s.pay_method = 'upi_autopay' then
    -- Refund any already-charged, not-yet-delivered day (bank captured, no wallet).
    if v_upi_refund > 0 then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (s.user_id, v_upi_refund, 'refund',
                'UPI Autopay cancelled — refund for already-charged day(s)', null, s.user_id);
    end if;
    -- Reclaim the ₹1 setup credit (floored at balance so the wallet can't go negative).
    if coalesce(s.mandate_status, '') = 'confirmed' then
      select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = s.user_id;
      v_reclaim := least(1, greatest(v_bal, 0));
      if v_reclaim > 0 then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
          values (s.user_id, -v_reclaim, 'adjustment',
                  'UPI Autopay cancelled — ₹1 setup credit reversed', null, s.user_id);
      end if;
    end if;
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'UPI Autopay cancelled',
       'Your daily plan is cancelled — no more deliveries and no more auto-debits.'
       || case when v_upi_refund > 0 then ' ₹' || floor(v_upi_refund)::text
                || ' for the already-charged day is back in your NGS Wallet.' else '' end);

  else
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Subscription cancelled',
       'Your daily plan is cancelled. No more deliveries or charges will be made.');
  end if;
end; $$;
revoke execute on function public.cancel_subscription(uuid) from public, anon;
grant execute on function public.cancel_subscription(uuid) to authenticated;

-- ── 2. skip_next_delivery: refund captured upi day + don't rewind days_done ─────
create or replace function public.skip_next_delivery(p_id uuid)
returns date
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions; v_next date; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_milk int; r record;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status <> 'active' then raise exception 'This plan is not active.'; end if;

  select min(deliver_on) into v_next from public.orders
    where subscription_id = p_id and status = 'Scheduled' and payment_method = 'subscription';
  if v_next is null then
    select d into v_next from (
      select s.start_date + g as d
      from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
    ) t where t.d <> all (coalesce(s.skip_dates, '{}'::date[])) order by t.d offset s.days_done limit 1;
  end if;
  if v_next is null or v_next <= v_today then
    raise exception 'Too late to skip — that delivery is today or already on the way.';
  end if;

  update public.subscriptions
    set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), v_next), updated_at = now()
    where id = p_id;

  update public.products pr set stock = pr.stock + agg.qty
    from (select oi.product_id, sum(oi.qty) qty
          from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.subscription_id = p_id and o.deliver_on = v_next and o.status = 'Scheduled'
          group by oi.product_id) agg
    where pr.id = agg.product_id and pr.stock is not null;

  -- Refund prepaid ADD-ON orders on that date.
  for r in select id, total, human_code from public.orders
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled'
      and payment_method <> 'subscription' and payment_status = 'paid' loop
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, r.total, 'refund', 'Skipped delivery — ' || r.human_code, r.id, s.user_id);
  end loop;

  -- UPI Autopay: the milk day was already bank-charged (wallet_used=0), so refund
  -- it too — the cancel below won't (nothing was taken from the wallet).
  if s.pay_method = 'upi_autopay' then
    for r in select id, total, human_code from public.orders
      where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled'
        and payment_method = 'subscription' and payment_status = 'paid' and coalesce(wallet_used, 0) = 0 loop
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (s.user_id, r.total, 'refund', 'Skipped delivery — ' || r.human_code, r.id, s.user_id);
    end loop;
  end if;

  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled' and payment_method = 'subscription';
  get diagnostics v_milk = row_count;
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled' and payment_method <> 'subscription';

  -- Make-up (rewind days_done) applies only to prepaid / wallet_daily plans. UPI
  -- Autopay is pay-per-delivery and refunded above; appending to skip_dates already
  -- advances it to the next date, so rewinding would double-charge or strand it.
  if v_milk > 0 and s.pay_method <> 'upi_autopay' then
    update public.subscriptions set days_done = greatest(days_done - v_milk, 0), updated_at = now() where id = p_id;
  end if;

  perform public.sub_generate_due(p_id);   -- no-op for upi_autopay (guarded)
  return v_next;
end; $$;
revoke execute on function public.skip_next_delivery(uuid) from public, anon;
grant execute on function public.skip_next_delivery(uuid) to authenticated;

-- ── 3. sub_upi_settle_success: refund a debit that captures after cancel ────────
create or replace function public.sub_upi_settle_success(p_rzp_order text, p_payment text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare c public.subscription_charges; s public.subscriptions; v_made boolean;
begin
  select * into c from public.subscription_charges where rzp_order_id = p_rzp_order for update;
  if c.id is null then return; end if;
  if c.status = 'paid' then return; end if;               -- already settled

  update public.subscription_charges
    set status = 'paid', rzp_payment_id = coalesce(p_payment, rzp_payment_id), updated_at = now()
    where id = c.id;

  select * into s from public.subscriptions where id = c.subscription_id for update;
  if s.id is null then return; end if;

  if s.status = 'active'
     and s.last_delivery is distinct from c.deliver_date
     and public.sub_upi_next_deliver(s) = c.deliver_date then
    v_made := public._sub_create_order(s, c.deliver_date);
    if v_made then
      update public.subscriptions
        set days_done = days_done + 1, last_delivery = c.deliver_date, updated_at = now()
        where id = s.id;
      update public.subscriptions
        set status = 'completed', updated_at = now()
        where id = s.id and days_done >= days_total and status = 'active';
    end if;
  elsif s.status <> 'active' then
    -- Debit captured after the plan was cancelled/completed → no delivery will be
    -- made, so refund the customer instead of keeping the money.
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, c.amount, 'refund',
              'UPI Autopay charge refunded — plan was cancelled before delivery', null, s.user_id);
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Autopay charge refunded',
       '₹' || floor(c.amount)::text || ' was auto-debited just as your plan ended, so we''ve refunded it to your NGS Wallet.');
  end if;
end; $$;
revoke all on function public.sub_upi_settle_success(text, text) from public, anon, authenticated;

commit;
