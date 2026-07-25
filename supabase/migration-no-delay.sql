-- ═══════════════════════════════════════════════════════════════════════════
--  Kill every scheduling delay.
--
--  Root cause: the database runs in UTC, so an hourly cron written as ':15'
--  actually fired at :45 India time. Combined with hour-granularity checks, an
--  8 AM subscription could not activate until the 08:45 IST run — 45 minutes
--  late, and 09:45 if anything slipped. Store hours and surge were on a 10-min
--  cron, so they lagged by up to 10 minutes.
--
--  Fix: separate the CHEAP "is anything due right now?" release from the
--  EXPENSIVE generation work, and run the release every single minute. Minute
--  crons are immune to the UTC/IST offset entirely.
-- ═══════════════════════════════════════════════════════════════════════════

-- Light, idempotent: flips anything whose delivery hour has arrived.
create or replace function public.release_due_orders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_sub int := 0; v_slot int := 0;
begin
  -- Each is already guarded and safe to call repeatedly; isolate failures so a
  -- problem in one never blocks the other.
  begin v_sub  := coalesce(public.sub_activate_due(), 0);        exception when others then v_sub  := 0; end;
  begin v_slot := coalesce(public.activate_due_slot_orders(), 0); exception when others then v_slot := 0; end;
  return v_sub + v_slot;
end; $$;
revoke all on function public.release_due_orders() from public, anon, authenticated;

-- ── re-schedule ─────────────────────────────────────────────────────────────
do $$
begin
  -- store open/close + surge: every minute (was every 10 minutes)
  perform cron.unschedule('store-automation');
  perform cron.schedule('store-automation', '* * * * *', 'select public.run_store_automation()');

  -- NEW: release due subscription + scheduled orders every minute
  begin perform cron.unschedule('release-due-orders'); exception when others then null; end;
  perform cron.schedule('release-due-orders', '* * * * *', 'select public.release_due_orders()');

  -- heavy work (generate tomorrow's orders, clean up stale plans) every 15 min
  perform cron.unschedule('subscriptions');
  perform cron.schedule('subscriptions', '*/15 * * * *', 'select public.run_subscriptions()');
end $$;
