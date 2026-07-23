-- ════════════════════════════════════════════════════════════════════════════
-- Security audit remediation (final pass). Fixes verified, live-proven issues:
--   • partner_penalize was callable by ANY anonymous user (fine/suspend any
--     partner) — now cron/service-role only.
--   • partner_mark_* had a NULL-comparison auth bypass on unassigned orders
--     (anyone could mark an order Delivered+paid) — guards made NULL-safe
--     (done in a companion patch) + anon EXECUTE revoked here.
--   • smart_reprice / weather_debounce / activate_due_slot_orders /
--     _reset_stale_presence were customer/anon-callable — revoked.
--   • advance_order_status let any staff move ANY order to Delivered+paid —
--     now restricted to the assigned rider/picker or an admin.
--   • cancel_my_unpaid_order didn't refund wallet/points debited at placement —
--     now it does.
--   • Direct client write grants on money tables removed (all writes already go
--     through SECURITY DEFINER RPCs) — removes a catastrophic-if-RLS-slips
--     landmine.
--   • The legacy `upi` payment path (free goods + free membership + COD-cap
--     bypass) is fixed separately by treating 'upi' as an online payment that
--     must be confirmed before settlement.
-- ════════════════════════════════════════════════════════════════════════════

-- ── advance_order_status: require admin OR the order's assigned partner ──────
create or replace function public.advance_order_status(p_order uuid, p_status text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_order public.orders;
  v_flow  text[] := array['Placed', 'Packed', 'Out for delivery', 'Delivered'];
  v_cur   int; v_new int;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin()
          or (v_order.rider_id  is not null and v_order.rider_id  = auth.uid())
          or (v_order.picker_id is not null and v_order.picker_id = auth.uid())) then
    raise exception 'Not your order.';
  end if;
  v_new := array_position(v_flow, p_status);
  if v_new is null then raise exception 'Invalid status.'; end if;
  v_cur := array_position(v_flow, v_order.status);
  if v_cur is not null and v_new < v_cur then
    raise exception 'Status can only move forward.';
  end if;
  update public.orders set
    status = p_status,
    delivered_at = case when p_status = 'Delivered' and delivered_at is null then now() else delivered_at end,
    payment_status = case when p_status = 'Delivered' and payment_status <> 'paid' then 'paid' else payment_status end
  where id = p_order;
end; $function$;

-- ── cancel_my_unpaid_order: also return wallet + redeemed points ────────────
create or replace function public.cancel_my_unpaid_order(p_order_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare o public.orders;
begin
  select * into o from public.orders
   where id = p_order_id and user_id = auth.uid()
     and status = 'Awaiting payment' and coalesce(payment_status, '') <> 'paid';
  if o.id is null then return; end if;

  update public.orders set status = 'Payment failed' where id = o.id;

  if coalesce(o.wallet_used, 0) > 0 and not coalesce(o.wallet_restored, false)
     and exists (select 1 from public.customer_wallet where order_id = o.id and kind = 'spent') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (o.user_id, o.wallet_used, 'refund', 'Wallet returned (payment not completed)', o.id, o.user_id);
    update public.orders set wallet_restored = true where id = o.id;
  end if;

  if coalesce(o.points_redeemed, 0) > 0 and not coalesce(o.points_restored, false)
     and exists (select 1 from public.points_ledger where order_id = o.id and reason like 'Redeemed on%') then
    update public.profiles set points = points + o.points_redeemed where id = o.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (o.user_id, o.id, o.points_redeemed, 'Redeemed points returned (payment not completed)');
    update public.orders set points_restored = true where id = o.id;
  end if;
end; $function$;

-- ── EXECUTE revokes ─────────────────────────────────────────────────────────
-- Cron/service-role only (internal SECURITY DEFINER callers are unaffected):
revoke execute on function public.partner_penalize(uuid, text, uuid, uuid) from anon, authenticated;
revoke execute on function public.smart_reprice() from anon, authenticated;
revoke execute on function public.weather_debounce(boolean) from anon, authenticated, public;
revoke execute on function public.activate_due_slot_orders() from anon, authenticated, public;
revoke execute on function public._reset_stale_presence() from anon, authenticated, public;

-- Partner-only fulfilment functions: partners authenticate, so keep
-- `authenticated` (the NULL-safe internal guard restricts to the assigned
-- partner) but there is no reason for `anon` to reach them.
revoke execute on function public.partner_mark_delivered(uuid) from anon;
revoke execute on function public.partner_mark_packed(uuid) from anon;
revoke execute on function public.partner_mark_out_for_delivery(uuid) from anon;
revoke execute on function public.partner_mark_returned(uuid) from anon;

-- Admin-only functions carry an is_admin() guard internally; strip the leftover
-- `anon` grant as defense-in-depth (admins are the `authenticated` role, kept).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' escape '\'
           or p.proname in ('set_partner_status','set_staff_role',
                            'partner_deposit_cash','partner_record_payout'))
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;

-- ── Table write grants: money tables are written ONLY by SECURITY DEFINER RPCs
-- (verified: no client does a direct .insert/.update/.delete on these), so the
-- caller-level write grant is pure attack surface. Remove it. (orders/profiles
-- are intentionally left — the admin app updates them directly, gated by RLS +
-- the guard_profile_update trigger.) ────────────────────────────────────────
revoke insert, update, delete on public.customer_wallet from anon, authenticated;
revoke insert, update, delete on public.points_ledger   from anon, authenticated;
revoke insert, update, delete on public.order_items      from anon, authenticated;
revoke insert, update, delete on public.referrals        from anon, authenticated;
revoke insert, update, delete on public.wallet_ledger    from anon, authenticated;

select 'security-audit-final applied' as status;
