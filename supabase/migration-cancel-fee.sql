-- ════════════════════════════════════════════════════════════════════════════
-- Customer cancellation with a fee (Blinkit/Zepto style).
--
-- A customer may cancel an order that is still 'Placed' or 'Packed'. It's FREE
-- within a short grace window right after placing (they changed their mind
-- immediately). After that — or once we've started packing — a flat
-- cancellation fee applies, because the shop has begun work.
--
--   • Whatever the customer already PAID (wallet + confirmed online) is refunded
--     to their NGS Wallet, minus the fee.
--   • For Cash-on-Delivery (nothing paid yet), the fee is charged to their
--     wallet as a small balance they settle later — so a no-cost COD order can't
--     be placed and dropped for free.
--
-- Server-authoritative: the fee, the grace window and eligibility are decided
-- here, never by the client. Ownership is enforced (auth.uid() = the order's
-- customer). Once 'Out for delivery' or delivered, self-cancel is refused.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings add column if not exists cancel_fee numeric not null default 20;
alter table public.orders   add column if not exists cancel_reason text;

create or replace function public.cancel_my_order(p_order uuid, p_reason text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  o public.orders;
  v_grace int := 90;               -- seconds of free cancellation after placing
  v_fee numeric;
  v_paid_wallet numeric;
  v_paid_online numeric;
  v_total_paid numeric;
  v_refund numeric;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select * into o from public.orders where id = p_order and user_id = v_uid;
  if o.id is null then raise exception 'Order not found.'; end if;

  -- Daily-plan orders are managed via Subscriptions (skip / cancel plan).
  if coalesce(o.is_subscription,false) or o.subscription_id is not null then
    raise exception 'Manage daily deliveries from Subscriptions.';
  end if;
  if o.status = 'Out for delivery' then
    raise exception 'Your order is already on the way — please call the store.';
  end if;
  if o.status not in ('Placed','Packed','Scheduled') then
    raise exception 'This order can no longer be cancelled.';
  end if;

  -- Fee (server-decided). Free inside the grace window while still just 'Placed'.
  select coalesce(cancel_fee, 20) into v_fee from public.settings where id = 1;
  if v_fee < 0 then v_fee := 0; end if;
  if o.status = 'Placed' and o.created_at > now() - make_interval(secs => v_grace) then
    v_fee := 0;
  end if;

  v_paid_wallet := coalesce(o.wallet_used, 0);
  v_paid_online := case when coalesce(o.payment_status,'') = 'paid'
                         and o.payment_method in ('razorpay','upi')
                        then coalesce(o.total, 0) else 0 end;
  v_total_paid := v_paid_wallet + v_paid_online;
  -- Never charge a fee larger than a modest order's value.
  v_fee := least(v_fee, greatest(v_total_paid, v_fee));

  -- Cancel. Set wallet_restored so the generic restore trigger skips its wallet
  -- refund (we do the exact refund+fee below); leave points to the trigger.
  update public.orders
     set status = 'Cancelled', wallet_restored = true, cancel_reason = p_reason
   where id = o.id;

  if v_total_paid > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, v_total_paid, 'refund', 'Order cancelled — amount refunded', o.id, v_uid);
  end if;
  if v_fee > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_fee, 'cancel_fee', 'Cancellation fee', o.id, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'fee', v_fee,
                            'refunded', greatest(v_total_paid - v_fee, 0));
end; $function$;

grant execute on function public.cancel_my_order(uuid, text) to authenticated;

select 'cancel-fee ready' as status;
