-- ════════════════════════════════════════════════════════════════════════════
-- Security & money-loophole hardening — audit round 2
-- Fixes: partner self-approval, replayable payout/refund RPCs, wallet
-- double-spend via membership, scratch double-claim, KYC swap, cost leaks,
-- negative-points race. (place_order referral cap+lock is patched separately.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── C1 · A customer must NOT be able to self-approve as a partner ────────────
-- The partners INSERT policy checks row ownership but not `status`, so a user
-- could INSERT themselves as status='approved'. Force pending on any non-admin
-- insert (admins still set status via their own RPCs).
create or replace function public.guard_partner_insert()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_partner_insert on public.partners;
create trigger trg_guard_partner_insert before insert on public.partners
  for each row execute function public.guard_partner_insert();

-- ── #1 · partner_mark_delivered — idempotent (no replay to mint payout) ──────
create or replace function public.partner_mark_delivered(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean; v_dist numeric; v_member boolean; v_base numeric; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km, coalesce(member, false),
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid')
    into v_rid, v_total, v_dist, v_member, v_cash from public.orders where id = p_order;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your delivery.'; end if;
  perform public._ensure_pool(p_order);
  v_base := case when v_member then coalesce(cfg.rider_member_base, cfg.rider_base) else cfg.rider_base end;
  v_earn := round(
      v_base
    + greatest(coalesce(v_dist,0) - cfg.rider_free_km, 0) * cfg.rider_per_km
    + case when coalesce(cfg.surge_on,false) then cfg.peak_bonus else 0 end, 2);
  update public.orders
     set delivery_state = 'delivered', delivered_at = now(), status = 'Delivered',
         rider_earning = case when v_rid is not null then v_earn else 0 end,
         payment_status = case when v_cash then 'paid' else payment_status end
   where id = p_order and delivery_state <> 'delivered';   -- idempotency guard
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;                        -- already delivered → no double credit
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, 'Delivery', auth.uid());
    if v_cash then
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_total, v_total, 'Cash collected (COD)', auth.uid());
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $function$;

-- ── #1 · partner_mark_packed — idempotent ───────────────────────────────────
create or replace function public.partner_mark_packed(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_earn numeric; v_pid uuid; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or v_pid = auth.uid()) then raise exception 'Not your order to pack.'; end if;
  v_earn := round(cfg.picker_pack_fee, 2);
  update public.orders
     set picker_state = 'packed', packed_at = now(), status = 'Packed',
         picker_earning = case when v_pid is not null then v_earn else 0 end
   where id = p_order and picker_state <> 'packed';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $function$;

-- ── #1/#2 · partner_mark_returned — idempotent (also stops the double refund) ─
create or replace function public.partner_mark_returned(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare cfg public.ops_config; v_rid uuid; v_parent uuid; v_earn numeric; v_upd int;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, return_of into v_rid, v_parent from public.orders where id = p_order and is_return;
  if v_parent is null then raise exception 'Not a return order.'; end if;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your pickup.'; end if;
  v_earn := round(coalesce(cfg.rider_base, 0), 2);
  update public.orders
     set delivery_state = 'returned', delivered_at = now(), status = 'Returned',
         rider_earning = case when v_rid is not null then v_earn else 0 end
   where id = p_order and delivery_state <> 'returned';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;   -- already processed → no second earning / refund
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
      values (v_rid, p_order, 'earning', v_earn, 'Return pickup', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
  perform public.process_return_refund(p_order);
end $function$;

-- ── #3 · join_membership must serialize wallet spend like place_order ────────
create or replace function public.join_membership()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_bal numeric; v_until timestamptz;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));  -- same lock domain as place_order
  select member_until into v_until from public.profiles where id = v_uid;
  if v_until is not null and v_until > now() then
    raise exception 'You''re already a member until %. You can renew after it ends.', to_char(v_until,'DD Mon YYYY');
  end if;
  v_cfg := coalesce((select rewards->'membership' from public.settings where id=1), '{}'::jsonb);
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then raise exception 'Membership isn''t available right now.'; end if;
  v_price := coalesce((v_cfg->>'price')::numeric, 99);
  v_days  := coalesce((v_cfg->>'days')::int, 30);
  select coalesce(sum(amount),0) into v_bal from public.customer_wallet where user_id = v_uid;
  if v_bal < v_price then
    raise exception 'You need ₹% in your NGS Wallet. Your balance is ₹%.', trunc(v_price)::text, trunc(v_bal)::text;
  end if;
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (v_uid, -v_price, 'spent', 'NGS Prime membership', v_uid);
  perform public._activate_membership(v_uid, v_days);
  return jsonb_build_object('ok', true);
end $function$;

-- ── #4 · claim_scratch_reward — atomic (lock the order row) ──────────────────
create or replace function public.claim_scratch_reward(p_order uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare o public.orders; v_pts int; v_cash numeric; v_reward jsonb; v_upd int;
begin
  select * into o from public.orders where id = p_order for update;   -- serialize concurrent claims
  if o.id is null or o.user_id <> auth.uid() then raise exception 'Order not found.'; end if;
  if o.status <> 'Delivered' then raise exception 'You can scratch after delivery.'; end if;
  if o.is_return then raise exception 'No reward on a return.'; end if;
  if coalesce(o.scratch_claimed, false) then
    return coalesce(o.scratch_reward, jsonb_build_object('points',0,'wallet',0));
  end if;
  v_pts  := greatest(coalesce(o.scratch_points, 0), 0);
  v_cash := greatest(coalesce(o.scratch_wallet, 0), 0);
  v_reward := jsonb_build_object('points', v_pts, 'wallet', v_cash);
  update public.orders set scratch_claimed = true, scratch_reward = v_reward
    where id = p_order and coalesce(scratch_claimed, false) = false;
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return coalesce((select scratch_reward from public.orders where id = p_order), v_reward); end if;
  if v_pts > 0 then
    update public.profiles set points = points + v_pts where id = o.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (o.user_id, o.id, v_pts, 'Scratch reward on ' || o.human_code);
  end if;
  if v_cash > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (o.user_id, v_cash, 'reward', 'Scratch reward on ' || o.human_code, o.id, o.user_id);
  end if;
  return v_reward;
end $function$;

-- ── #6 (low) · redeem_points — atomic, cannot drive points negative ─────────
create or replace function public.redeem_points(p_points integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_bal int; v_upd int;
begin
  if p_points <= 0 then raise exception 'Nothing to redeem.'; end if;
  update public.profiles set points = points - p_points
    where id = auth.uid() and points >= p_points;
  get diagnostics v_upd = row_count;
  if v_upd = 0 then raise exception 'Not enough points.'; end if;
  insert into public.points_ledger (user_id, delta, reason) values (auth.uid(), -p_points, 'Redeemed');
  select points into v_bal from public.profiles where id = auth.uid();
  return v_bal;
end; $function$;

-- ── M6 · Approved partner can't silently swap KYC docs that weren't requested
create or replace function public.partner_submit_kyc_item(p_item text, p_path text, p_extra text default null)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.partners set
    selfie_path         = case when p_item = 'selfie' then p_path else selfie_path end,
    liveness_video_path = case when p_item = 'selfie' then coalesce(p_extra, liveness_video_path) else liveness_video_path end,
    aadhaar_front       = case when p_item = 'aadhaar_front' then p_path else aadhaar_front end,
    aadhaar_back        = case when p_item = 'aadhaar_back' then p_path else aadhaar_back end,
    pan                 = case when p_item = 'pan' then p_path else pan end,
    dl                  = case when p_item = 'dl' then p_path else dl end,
    kyc_requests        = array_remove(kyc_requests, p_item)
  where user_id = auth.uid()
    and (status = 'pending' or p_item = any(kyc_requests));  -- once approved, only admin-requested docs
end $function$;

-- ── M4 · product_ops buying-price readable by admin only (not staff/partners)
drop policy if exists pops_read on public.product_ops;
create policy pops_read on public.product_ops for select using (public.is_admin());

-- ── low · expire_memberships utility RPC: revoke default PUBLIC execute ──────
revoke execute on function public.expire_memberships() from public, anon, authenticated;
