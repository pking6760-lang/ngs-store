-- UPI Autopay — Phase 7: handle a mandate the CUSTOMER revoked from their own UPI
-- app (not from our app).
--
-- If a customer turns off UPI Autopay in GPay/PhonePe, our plan is still "active"
-- and the engine will try to debit — but the bank REJECTS a revoked mandate, so
-- NO money is ever taken (a failed debit debits nothing). The only problem is the
-- plan would keep trying and failing. Two defences:
--   1. token.cancelled webhook  → cancel the plan the instant Razorpay tells us.
--   2. 3-strikes fallback        → if we can't debit 3 days running (revoked, or
--      chronically no balance), stop the plan on our own and tell the customer.
-- Both only ever STOP charging; neither can cause a debit.

begin;

-- ── Cancel the plan tied to a revoked mandate token (called by the webhook). ────
create or replace function public.cancel_sub_by_token(p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions;
begin
  if p_token is null or btrim(p_token) = '' then return; end if;
  for s in
    select * from public.subscriptions
    where mandate_token = p_token and pay_method = 'upi_autopay' and status = 'active'
  loop
    -- restore stock for any not-yet-delivered orders, then drop them
    update public.products pr set stock = pr.stock + agg.qty
      from (select oi.product_id, sum(oi.qty) qty from public.order_items oi
            join public.orders o on o.id = oi.order_id
            where o.subscription_id = s.id and o.status = 'Scheduled'
            group by oi.product_id) agg
      where pr.id = agg.product_id and pr.stock is not null;
    update public.orders set status = 'Cancelled'
      where subscription_id = s.id and status = 'Scheduled';

    update public.subscriptions set status = 'cancelled', updated_at = now() where id = s.id;
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'UPI Autopay turned off',
       'You turned off UPI Autopay from your UPI app, so we''ve stopped your daily plan. '
       || 'No further deliveries or debits. Re-subscribe anytime.');
  end loop;
end; $$;
revoke all on function public.cancel_sub_by_token(text) from public, anon, authenticated;

-- ── Failure handler: skip the failed day, and after 3 straight failures give up
-- and cancel the plan (a revoked mandate or a chronically empty account). ───────
create or replace function public._sub_upi_fail(c public.subscription_charges)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare s public.subscriptions; v_fails int; v_last_paid date;
begin
  if c.id is null or c.status = 'paid' then return; end if;

  update public.subscription_charges
    set status = 'failed', updated_at = now()
    where id = c.id and status <> 'paid';

  select * into s from public.subscriptions where id = c.subscription_id for update;
  if s.id is null or s.status <> 'active' then return; end if;

  -- Drop the failed delivery date so the plan rolls to the next day.
  if not (c.deliver_date = any (coalesce(s.skip_dates, '{}'::date[]))) then
    update public.subscriptions
      set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), c.deliver_date), updated_at = now()
      where id = s.id;
  end if;

  -- How many failures in a row since the last successful charge?
  select max(deliver_date) into v_last_paid from public.subscription_charges
    where subscription_id = s.id and status = 'paid';
  select count(*) into v_fails from public.subscription_charges
    where subscription_id = s.id and status = 'failed'
      and deliver_date > coalesce(v_last_paid, '1900-01-01');

  if v_fails >= 3 then
    -- Mandate is clearly not working — stop trying and cancel cleanly.
    update public.subscriptions set status = 'cancelled', updated_at = now() where id = s.id;
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Autopay stopped',
       'We couldn''t auto-debit your UPI for 3 days in a row, so we''ve stopped your daily plan. '
       || 'If you turned off autopay in your UPI app, that''s expected. Re-subscribe anytime.');
  else
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Autopay couldn''t go through',
       'We couldn''t auto-debit for your ' || to_char(c.deliver_date, 'DD Mon') ||
       ' delivery, so we skipped that day. Please make sure your UPI autopay is on and has balance.');
  end if;
end; $$;
revoke all on function public._sub_upi_fail(public.subscription_charges) from public, anon, authenticated;

commit;
