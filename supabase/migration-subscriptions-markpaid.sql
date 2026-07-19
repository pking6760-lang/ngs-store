-- ════════════════════════════════════════════════════════════════════════════
-- Hook prepaid subscriptions into the payment-confirmation hub.
--   When an online (razorpay) advance-payment order for a plan is confirmed,
--   activate the plan and create the first (tomorrow) order. Wallet plans are
--   activated inline in create_subscription_order, so this branch is the online
--   path. Additive branch — everything else is the existing mark_order_paid.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mark_order_paid(p_order uuid, p_payment_id text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_order public.orders;
  v_line  record;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.payment_status = 'paid' then return; end if;
  if v_order.status = 'Cancelled' then return; end if;

  if coalesce(v_order.is_membership, false) then
    perform public._activate_membership(v_order.user_id, coalesce(v_order.membership_days, 30));
    update public.orders set payment_status = 'paid', status = 'Membership',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    return;
  end if;

  -- Wallet top-up → credit the wallet, mark paid, and stop (no fulfilment).
  if coalesce(v_order.is_topup, false) then
    if not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'topup') then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_order.user_id, v_order.total, 'topup', 'Added to wallet', p_order, v_order.user_id);
    end if;
    update public.orders set payment_status = 'paid', status = 'Wallet top-up',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    return;
  end if;

  -- Prepaid subscription plan (online path) → activate + create the first order.
  if coalesce(v_order.is_subscription, false) then
    update public.orders set payment_status = 'paid', status = 'Subscription',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_order.subscription_id and status = 'pending';
    perform public.sub_generate_due(v_order.subscription_id);
    return;
  end if;

  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'Awaiting payment' then 'Placed' else status end,
    razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
  where id = p_order;

  for v_line in select product_id, qty from public.order_items where order_id = p_order loop
    update public.products set stock = greatest(0, stock - v_line.qty)
      where id = v_line.product_id and stock is not null;
  end loop;

  if coalesce(v_order.wallet_used, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'spent') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, -v_order.wallet_used, 'spent', 'Used on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.points_redeemed, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Redeemed on%') then
    update public.profiles set points = greatest(0, points - v_order.points_redeemed) where id = v_order.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, -v_order.points_redeemed, 'Redeemed on ' || v_order.human_code);
  end if;

  if v_order.points_earned > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Earned%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.points_earned, 'Earned on ' || v_order.human_code);
    update public.profiles set points = points + v_order.points_earned where id = v_order.user_id;
  end if;

  if coalesce(v_order.member_bonus_points, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Prime bonus%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.member_bonus_points, 'Prime bonus on ' || v_order.human_code);
    update public.profiles set points = points + v_order.member_bonus_points where id = v_order.user_id;
  end if;
  if coalesce(v_order.member_bonus_wallet, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'reward' and note like 'Prime bonus%') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, v_order.member_bonus_wallet, 'reward', 'Prime bonus on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.membership_days, 0) > 0 then
    perform public._activate_membership(v_order.user_id, v_order.membership_days);
  end if;

  if not coalesce(v_order.is_return, false) then
    update public.profiles set
      order_count = coalesce(order_count, 0) + 1,
      member_order_count = case when coalesce(v_order.member, false) then coalesce(member_order_count, 0) + 1 else member_order_count end
    where id = v_order.user_id;
  end if;
end;
$function$;
