-- UPI Autopay Phase 11 — skip the next delivery cleanly (no confusing refund).
--
-- Bug: skip_next_delivery skipped the earliest *scheduled order*, but for autopay
-- that is the imminent, already-PAID day — so it refunded to the wallet, while the
-- app's dialog named the *next* (unpaid) day. The customer saw "moves to the end"
-- yet got a refund, and the wrong day was skipped.
--
-- Fix: for autopay, skip the customer's next AS-SHOWN delivery — the next slot not
-- yet scheduled/charged (sub_upi_next_deliver). It carries no committed money, so
-- it simply moves to the end of the plan: no refund, all deliveries still made. The
-- imminent already-paid day is left to deliver. Any pre-debit already queued for a
-- skipped day is cancelled so the bank is never charged for it.
create or replace function public.skip_next_delivery(p_id uuid)
returns date
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s public.subscriptions; v_next date; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_milk int; r record;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status <> 'active' then raise exception 'This plan is not active.'; end if;

  if s.pay_method = 'upi_autopay' then
    -- Pay-per-delivery: skip the next slot not yet scheduled/charged (the day the
    -- app shows as "Next delivery"). No money is committed to it, so it just moves
    -- to the end — no refund.
    v_next := public.sub_upi_next_deliver(s);
  else
    select min(deliver_on) into v_next from public.orders
      where subscription_id = p_id and status = 'Scheduled' and payment_method = 'subscription';
    if v_next is null then
      select d into v_next from (
        select s.start_date + g as d
        from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
      ) t where t.d <> all (coalesce(s.skip_dates, '{}'::date[])) order by t.d offset s.days_done limit 1;
    end if;
  end if;
  if v_next is null or v_next <= v_today then
    raise exception 'Too late to skip — that delivery is today or already on the way.';
  end if;

  update public.subscriptions
    set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), v_next), updated_at = now()
    where id = p_id;

  -- Autopay: if a pre-debit was already queued (or is mid-flight) for this day,
  -- cancel it so the bank is never charged for a skipped delivery.
  update public.subscription_charges set status = 'failed', updated_at = now()
    where subscription_id = p_id and deliver_date = v_next and status in ('notified', 'processing');

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

  -- UPI Autopay: refund only a genuinely already-paid milk day (bank-charged,
  -- wallet_used=0). Normally the skipped day is a future unpaid one, so this is a
  -- no-op — the refund never fires for a day no money was taken for.
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
  -- Autopay skips a not-yet-scheduled day, so days_done already excludes it and
  -- appending to skip_dates advances the pipeline — no rewind.
  if v_milk > 0 and s.pay_method <> 'upi_autopay' then
    update public.subscriptions set days_done = greatest(days_done - v_milk, 0), updated_at = now() where id = p_id;
  end if;

  perform public.sub_generate_due(p_id);   -- no-op for upi_autopay (guarded)
  return v_next;
end; $function$;
