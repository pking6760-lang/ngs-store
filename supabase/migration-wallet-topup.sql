-- ============================================================================
-- Customer wallet TOP-UP via UPI / Razorpay.
--
-- Mirrors the online-membership flow exactly: a tiny "order" flagged is_topup
-- runs through the SAME Razorpay QR / webhook pipeline. When Razorpay confirms
-- payment, mark_order_paid credits the customer's wallet (kind 'topup') instead
-- of activating membership. Top-up orders never notify the admin and never
-- enter the picking/delivery pipeline (same carve-outs as membership).
--
-- Money only moves after Razorpay confirms — the client can never self-credit.
-- ============================================================================

alter table public.orders add column if not exists is_topup boolean not null default false;

-- ── Create a top-up order (₹50–₹10,000) → returns the order for the QR flow. ──
create or replace function public.create_topup_order(p_amount numeric)
 returns public.orders language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_amt numeric; v_p public.profiles; v_o public.orders; v_code text;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  v_amt := floor(coalesce(p_amount, 0));                 -- whole rupees only
  if v_amt < 50 then raise exception 'Minimum top-up is ₹50.'; end if;
  if v_amt > 10000 then raise exception 'Maximum top-up is ₹10,000 at a time.'; end if;
  select * into v_p from public.profiles where id = v_uid;
  v_code := 'NGSW' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_topup
  ) values (
    v_code, v_uid, v_p.name, v_p.phone, 'Awaiting payment',
    v_amt, v_amt, 'razorpay', 'pending', true
  ) returning * into v_o;
  return v_o;
end $function$;
grant execute on function public.create_topup_order(numeric) to authenticated;

-- ── mark_order_paid: add a TOP-UP branch (credit wallet) before the normal
--    order path. Reproduces the current (member-honeymoon) definition verbatim
--    and only inserts the is_topup branch after the membership branch. ──
create or replace function public.mark_order_paid(p_order uuid, p_payment_id text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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

  -- NEW: wallet top-up → credit the wallet, mark paid, and stop (no fulfilment).
  if coalesce(v_order.is_topup, false) then
    if not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'topup') then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_order.user_id, v_order.total, 'topup', 'Added to wallet', p_order, v_order.user_id);
    end if;
    update public.orders set payment_status = 'paid', status = 'Wallet top-up',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
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

-- ── Keep top-up orders out of the fulfilment pipeline (mirror is_membership). ──
create or replace function public.dispatch_order(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_uid uuid; v_is_return boolean; v_is_mem boolean; v_is_top boolean;
begin
  select is_return, is_membership, is_topup into v_is_return, v_is_mem, v_is_top from public.orders where id = p_order;
  if coalesce(v_is_mem,false) or coalesce(v_is_top,false) then return; end if;
  select * into cfg from public.ops_config where id = 1;
  if not coalesce(v_is_return,false)
     and cfg.coverage_picking = 'staff'
     and (select picker_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('picker', p_order);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', p_order);
    end if;
  end if;
  if (coalesce(v_is_return,false) or cfg.coverage_delivery = 'staff')
     and (select rider_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('delivery', p_order);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', p_order);
    end if;
  end if;
end; $function$;

-- ── Don't ping the admin's new-order alarm for a top-up (mirror is_membership). ──
create or replace function public.notify_admin_new_order()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(NEW.is_return, false) or coalesce(NEW.is_membership, false) or coalesce(NEW.is_topup, false) then return NEW; end if;
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret',(select value from private.app_secret where key = 'webhook_secret')),
    body := jsonb_build_object('type','INSERT','record', to_jsonb(NEW))
  );
  return NEW;
end;
$function$;
