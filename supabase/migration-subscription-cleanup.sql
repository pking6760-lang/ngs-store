-- ════════════════════════════════════════════════════════════════════════════
-- Don't let unpaid "pending" subscription plans linger.
--   Generating the online-payment QR creates a pending plan + an Awaiting-payment
--   advance order. If the customer never pays (or was just looking), that plan
--   must not pile up in their Subscriptions list.
--   • discard_pending_subscription(): called when the customer leaves the pay
--     screen — removes the pending plan and its unpaid order.
--   • run_subscriptions() now also sweeps away pending plans older than 2 hours
--     (a safety net for app-killed / abandoned cases).
-- ════════════════════════════════════════════════════════════════════════════

-- One-time cleanup of the plans already stranded in 'pending'.
delete from public.orders where is_subscription and payment_status <> 'paid';
delete from public.subscriptions where status = 'pending';

create or replace function public.discard_pending_subscription(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.orders
    where subscription_id = p_id and is_subscription and payment_status <> 'paid';
  delete from public.subscriptions
    where id = p_id and user_id = auth.uid() and status = 'pending';
end; $function$;
revoke execute on function public.discard_pending_subscription(uuid) from public, anon;
grant execute on function public.discard_pending_subscription(uuid) to authenticated;

-- Hourly engine + sweep of abandoned unpaid plans.
create or replace function public.run_subscriptions()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_made int := 0;
begin
  -- Sweep abandoned, never-paid plans (and their unpaid advance orders).
  delete from public.orders o using public.subscriptions s
    where o.subscription_id = s.id and o.is_subscription and o.payment_status <> 'paid'
      and s.status = 'pending' and s.created_at < now() - interval '2 hours';
  delete from public.subscriptions
    where status = 'pending' and created_at < now() - interval '2 hours';

  for r in select id from public.subscriptions where status = 'active' loop
    begin perform public.sub_generate_due(r.id); exception when others then null; end;
  end loop;
  v_made := public.sub_activate_due();
  return v_made;
end; $function$;
revoke execute on function public.run_subscriptions() from public, anon, authenticated;
