-- ════════════════════════════════════════════════════════════════════════════
-- Abandoned / expired online payments must NOT look like a cancelled order.
-- Previously, leaving the pay screen (or the 45-min sweep) set the order to
-- 'Cancelled', which fired the customer "Order cancelled" push — alarming for
-- someone who simply didn't complete payment.
--
-- Online orders reserve no stock and take no wallet until payment succeeds, so
-- an unpaid one is a pure phantom. We now move it to a silent 'Payment failed'
-- status instead of 'Cancelled':
--   • the status-change notifier ignores 'Payment failed' → no push,
--   • it's hidden from customer history and the shop's order list,
--   • the row still exists, so a late UPI payment can still complete it.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_my_unpaid_order(p_order_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.orders set status = 'Payment failed'
   where id = p_order_id and user_id = auth.uid()
     and status = 'Awaiting payment' and coalesce(payment_status, '') <> 'paid';
end $$;

create or replace function public.expire_unpaid_orders()
 returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.orders set status = 'Payment failed'
   where status = 'Awaiting payment' and coalesce(payment_status, '') <> 'paid'
     and created_at < now() - interval '45 minutes';
end $$;

-- Convert the phantom 'Cancelled' rows that were really abandoned online
-- payments (never paid) so they stop showing in history.
update public.orders set status = 'Payment failed'
 where status = 'Cancelled'
   and coalesce(payment_status, '') <> 'paid'
   and lower(coalesce(payment_method, '')) in ('razorpay', 'upi', 'online')
   and not coalesce(is_membership, false) and not coalesce(is_topup, false);

select 'abandoned payments now silent' as status;
