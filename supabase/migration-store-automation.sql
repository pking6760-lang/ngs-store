-- ════════════════════════════════════════════════════════════════════════════
-- Store auto-pilot — the shop opens, closes and prices itself.
--   • Auto hours   : open at 8:00, close at 23:00 IST (owner-editable).
--   • Rain surge   : raining at the shop → surge pricing (harder to deliver).
--   • Peak surge   : live order rate spikes → surge pricing; reverts when calm.
-- Rain + peak both drive delivery_mode (normal/surge). A 2-hour "manual hold"
-- means any hand toggle in the admin pauses that dimension's automation for 2h,
-- so the auto-pilot never fights a deliberate override.
--
-- Split of work: the pure-SQL parts (hours window, peak from order rate) are
-- computed here; the one thing SQL can't do cheaply — the live weather lookup —
-- is done by the store-automation Edge Function, which calls the snapshot/apply
-- RPCs below. A cron pokes it every 10 minutes.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings
  add column if not exists automation jsonb not null
    default '{"hours":{"on":true,"open":8,"close":23},"rain":{"on":true},"peak":{"on":true,"min":4,"mult":3}}'::jsonb,
  add column if not exists auto_hours_hold_until timestamptz,
  add column if not exists auto_surge_hold_until timestamptz;

-- ── Manual-override hold ─────────────────────────────────────────────────────
-- When store_open / delivery_mode change from a HAND toggle (not the auto-pilot),
-- pause that dimension's automation for 2 hours. The apply function marks its own
-- writes with a transaction-local flag so they don't count as manual.
create or replace function public._settings_manual_hold()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if coalesce(current_setting('ngs.auto', true), '') <> '1' then
    if new.store_open is distinct from old.store_open then
      new.auto_hours_hold_until := now() + interval '2 hours';
    end if;
    if new.delivery_mode is distinct from old.delivery_mode then
      new.auto_surge_hold_until := now() + interval '2 hours';
    end if;
  end if;
  return new;
end; $function$;

drop trigger if exists trg_settings_manual_hold on public.settings;
create trigger trg_settings_manual_hold
  before update of store_open, delivery_mode on public.settings
  for each row execute function public._settings_manual_hold();

-- ── Snapshot: everything the Edge Function needs to decide (minus weather) ────
create or replace function public.store_automation_snapshot()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  s         public.settings;
  v_ist     timestamptz := now() at time zone 'Asia/Kolkata';
  v_min     int;
  v_open_h  int; v_close_h int;
  v_open_now boolean;
  v_recent  int;
  v_days14  int;
  v_base    numeric;
  v_min_ord int;
  v_mult    numeric;
  v_peak_now boolean;
  v_loc     jsonb;
begin
  select * into s from public.settings where id = 1;

  -- Hours window (minute precision).
  v_min    := extract(hour from v_ist)::int * 60 + extract(minute from v_ist)::int;
  v_open_h := coalesce((s.automation->'hours'->>'open')::int, 8);
  v_close_h:= coalesce((s.automation->'hours'->>'close')::int, 23);
  v_open_now := v_min >= v_open_h * 60 and v_min < v_close_h * 60;

  -- Peak: orders in the last 30 min vs the 14-day average per 30-min slot.
  select count(*) into v_recent from public.orders
   where created_at >= now() - interval '30 minutes'
     and status <> 'Cancelled'
     and not coalesce(is_return, false) and not coalesce(is_membership, false)
     and not coalesce(is_topup, false);
  select count(*) into v_days14 from public.orders
   where created_at >= now() - interval '14 days'
     and status <> 'Cancelled'
     and not coalesce(is_return, false) and not coalesce(is_membership, false)
     and not coalesce(is_topup, false);
  v_base    := v_days14 / (14.0 * 48.0);            -- avg orders per 30-min slot
  v_min_ord := coalesce((s.automation->'peak'->>'min')::int, 4);
  v_mult    := coalesce((s.automation->'peak'->>'mult')::numeric, 3);
  v_peak_now := v_recent >= greatest(v_min_ord, ceil(v_base * v_mult));

  v_loc := s.shop_locations->0;

  return jsonb_build_object(
    'automation',    s.automation,
    'store_open',    s.store_open,
    'delivery_mode', s.delivery_mode,
    'open_now',      v_open_now,
    'peak_now',      v_peak_now,
    'recent_orders', v_recent,
    'shop_lat',      (v_loc->>'lat'),
    'shop_lng',      (v_loc->>'lng')
  );
end; $function$;
revoke execute on function public.store_automation_snapshot() from public, anon, authenticated;

-- ── Apply: write back store_open / delivery_mode, honouring on-flags + holds ──
create or replace function public.store_automation_apply(p_open boolean, p_surge boolean)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s public.settings; v_mode text; v_did_open boolean := false; v_did_mode boolean := false;
begin
  perform set_config('ngs.auto', '1', true);   -- mark our writes as automation
  select * into s from public.settings where id = 1;

  -- Auto hours (if enabled and not on a manual hold).
  if coalesce((s.automation->'hours'->>'on')::boolean, false)
     and (s.auto_hours_hold_until is null or now() >= s.auto_hours_hold_until)
     and s.store_open is distinct from p_open then
    update public.settings set store_open = p_open where id = 1;
    v_did_open := true;
  end if;

  -- Auto surge (rain OR peak enabled, and not on a manual hold).
  if (coalesce((s.automation->'rain'->>'on')::boolean, false)
      or coalesce((s.automation->'peak'->>'on')::boolean, false))
     and (s.auto_surge_hold_until is null or now() >= s.auto_surge_hold_until) then
    v_mode := case when p_surge then 'surge' else 'normal' end;
    if s.delivery_mode is distinct from v_mode then
      update public.settings set delivery_mode = v_mode where id = 1;
      v_did_mode := true;
    end if;
  end if;

  return jsonb_build_object('changed_open', v_did_open, 'changed_mode', v_did_mode,
                            'store_open', p_open, 'surge', p_surge);
end; $function$;
revoke execute on function public.store_automation_apply(boolean, boolean) from public, anon, authenticated;

-- ── Cron poke → store-automation Edge Function (does the weather lookup) ─────
create or replace function public.run_store_automation()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/store-automation',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then null;
end; $function$;
revoke execute on function public.run_store_automation() from public, anon, authenticated;

-- Every 10 minutes.
select cron.unschedule('store-automation') where exists (select 1 from cron.job where jobname='store-automation');
select cron.schedule('store-automation', '*/10 * * * *', 'select public.run_store_automation()');
