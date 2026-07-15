-- ════════════════════════════════════════════════════════════════════════════
-- Release abandoned online (held) orders.
-- Without this, an order left in 'Awaiting payment' lingers forever — and if the
-- customer applied NGS wallet credit, that credit (debited at placement) is
-- never returned. Cancelling the order fires the existing wallet-restore trigger.
-- Razorpay QRs/links expire well before this window, so no real payment can
-- arrive after it (and mark_order_paid now refuses to confirm a cancelled order).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.expire_unpaid_orders()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.orders
     set status = 'Cancelled'
   where status = 'Awaiting payment'
     and coalesce(payment_status, '') <> 'paid'
     and created_at < now() - interval '45 minutes';
end $function$;

revoke execute on function public.expire_unpaid_orders() from public, anon, authenticated;

-- Guard: never confirm an order that was already cancelled (e.g. by the sweep).
CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order uuid, p_payment_id text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_order public.orders;
  v_line  record;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.payment_status = 'paid' then return; end if;
  if v_order.status = 'Cancelled' then return; end if;  -- expired/cancelled → don't confirm

  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'Awaiting payment' then 'Placed' else status end,
    razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
  where id = p_order;

  for v_line in select product_id, qty from public.order_items where order_id = p_order loop
    update public.products set stock = greatest(0, stock - v_line.qty)
      where id = v_line.product_id and stock is not null;
  end loop;

  if v_order.points_earned > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order) then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.points_earned, 'Earned on ' || v_order.human_code);
    update public.profiles set points = points + v_order.points_earned where id = v_order.user_id;
  end if;
end;
$function$;

-- Schedule the sweep every 5 minutes (unschedule first so re-running is safe).
select cron.unschedule('expire-unpaid-orders') where exists (select 1 from cron.job where jobname = 'expire-unpaid-orders');
select cron.schedule('expire-unpaid-orders', '*/5 * * * *', $$select public.expire_unpaid_orders();$$);
