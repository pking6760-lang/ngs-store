-- UPI Autopay — Phase 6: fix the cancel-refund loophole + cancel/setup messaging.
--
-- BUG: cancel_subscription refunded unused days to the wallet for every plan
-- except wallet_daily. But upi_autopay is ALSO pay-per-delivery (nothing is
-- prepaid), so cancelling a upi_autopay plan handed the customer the full unused
-- value as free wallet money (a ₹134/day × 30 plan refunded ₹4020 that was never
-- paid). Refunds must apply ONLY to genuinely prepaid plans (wallet / razorpay).
--
-- Also: reclaim the ₹1 setup credit when a upi_autopay plan is cancelled, and
-- always notify the customer on setup + cancellation (the notifications trigger
-- fires a push).

begin;

create or replace function public.cancel_subscription(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  s public.subscriptions; v_consumed int; v_left int; v_refund numeric;
  v_bal numeric; v_reclaim numeric;
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
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and status = 'Scheduled';

  -- consumed = DAILY delivery orders past Scheduled (exclude the advance-payment order)
  select count(*) into v_consumed from public.orders
    where subscription_id = p_id and not coalesce(is_subscription, false)
      and status not in ('Scheduled', 'Cancelled');
  v_left := greatest(s.days_total - v_consumed, 0);
  v_refund := v_left * s.daily_total;

  update public.subscriptions set status = 'cancelled', updated_at = now() where id = p_id;

  -- ── Refund ONLY genuinely prepaid plans (paid upfront). wallet_daily and
  -- upi_autopay are pay-per-delivery — the customer never prepaid the unused
  -- days, so there is nothing to refund. Refunding them would be free money.
  if s.status = 'active' and s.pay_method in ('wallet', 'razorpay') and v_refund > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, v_refund, 'refund',
              'Subscription cancelled — ' || v_left || ' day(s) refunded', null, s.user_id);
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Subscription cancelled',
       'Your plan is cancelled. ₹' || floor(v_refund)::text
       || ' for ' || v_left || ' unused day(s) is back in your NGS Wallet.');

  -- ── UPI Autopay: reclaim the ₹1 setup credit we gave when the mandate was
  -- confirmed (floored at the current balance so the wallet never goes negative),
  -- then notify. No plan money is refunded (none was prepaid).
  elsif s.pay_method = 'upi_autopay' then
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
       'Your daily plan is cancelled — no more deliveries and no more auto-debits will be made.');

  -- ── wallet_daily (or anything else): just tell them it stopped.
  else
    insert into public.notifications (user_id, title, body) values
      (s.user_id, 'Subscription cancelled',
       'Your daily plan is cancelled. No more deliveries or charges will be made.');
  end if;
end; $$;

revoke execute on function public.cancel_subscription(uuid) from public, anon;
grant execute on function public.cancel_subscription(uuid) to authenticated;

-- ── Setup success: notify the customer (+push) when the mandate first confirms.
create or replace function public.confirm_upi_mandate(p_order_dbid uuid, p_payment_id text, p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_sub uuid; v_uid uuid; v_rows int;
begin
  select subscription_id, user_id into v_sub, v_uid from public.orders where id = p_order_dbid;
  if v_sub is null then return; end if;

  update public.orders
    set payment_status = 'paid', status = 'Subscription',
        razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
    where id = p_order_dbid and payment_status <> 'paid';

  update public.subscriptions
    set mandate_token = coalesce(p_token, mandate_token),
        mandate_status = 'confirmed',
        status = case when status = 'pending' then 'active' else status end,
        start_date = coalesce(start_date, (now() at time zone 'Asia/Kolkata')::date + 1),
        updated_at = now()
    where id = v_sub and coalesce(mandate_status, '') <> 'confirmed';
  get diagnostics v_rows = row_count;

  if v_rows > 0 and v_uid is not null then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, 1, 'adjustment', 'UPI Autopay setup — ₹1 verification credited back', p_order_dbid, v_uid);
    insert into public.notifications (user_id, title, body) values
      (v_uid, 'UPI Autopay is set up',
       'Your daily plan is active. Your bank auto-pays each day''s amount the evening before delivery — your first delivery is scheduled.');
  end if;
end; $$;
revoke all on function public.confirm_upi_mandate(uuid, text, text) from public;

commit;
