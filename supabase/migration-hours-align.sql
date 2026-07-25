-- The customer store's auto-open hour lived in settings.automation.hours while
-- the real shop hours live in ops_config. They had drifted apart (8 vs 6), so
-- automation kept the store shut for the first two trading hours every day.
-- Align automation to the real shop hours, and keep them in sync from now on.
update public.settings s
   set automation = jsonb_set(
         jsonb_set(coalesce(s.automation, '{}'::jsonb), '{hours,open}',
                   to_jsonb(coalesce(o.store_open_hour, 6)), true),
         '{hours,close}', to_jsonb(coalesce(o.store_close_hour, 23)), true)
  from public.ops_config o
 where s.id = 1 and o.id = 1;

-- Keep them aligned automatically: whenever shop hours change in ops_config,
-- push them into the automation config so the two can never disagree again.
create or replace function public._sync_automation_hours()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.store_open_hour is distinct from OLD.store_open_hour
     or NEW.store_close_hour is distinct from OLD.store_close_hour then
    update public.settings
       set automation = jsonb_set(
             jsonb_set(coalesce(automation, '{}'::jsonb), '{hours,open}',
                       to_jsonb(coalesce(NEW.store_open_hour, 6)), true),
             '{hours,close}', to_jsonb(coalesce(NEW.store_close_hour, 23)), true)
     where id = 1;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_sync_automation_hours on public.ops_config;
create trigger trg_sync_automation_hours
  after update on public.ops_config
  for each row execute function public._sync_automation_hours();

-- Timezone hardening: v_ist was declared timestamptz but assigned a naive IST
-- timestamp, so it only produced the right hour because the cast in and the
-- extract out both used UTC and cancelled. Declare it as a plain timestamp so
-- the hour is unambiguous regardless of the session timezone.
create or replace function public.store_automation_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.settings;
  v_ist     timestamp := (now() at time zone 'Asia/Kolkata');   -- naive IST, explicit
  v_min int; v_open_h int; v_close_h int; v_open_now boolean;
  v_recent int; v_days14 int; v_base numeric; v_min_ord int; v_mult numeric;
  v_peak_now boolean; v_loc jsonb;
begin
  select * into s from public.settings where id = 1;

  v_min     := extract(hour from v_ist)::int * 60 + extract(minute from v_ist)::int;
  v_open_h  := coalesce((s.automation->'hours'->>'open')::int, 6);
  v_close_h := coalesce((s.automation->'hours'->>'close')::int, 23);
  v_open_now := v_min >= v_open_h * 60 and v_min < v_close_h * 60;

  select count(*) into v_recent from public.orders
   where created_at >= now() - interval '30 minutes' and status <> 'Cancelled'
     and not coalesce(is_return,false) and not coalesce(is_membership,false) and not coalesce(is_topup,false);
  select count(*) into v_days14 from public.orders
   where created_at >= now() - interval '14 days' and status <> 'Cancelled'
     and not coalesce(is_return,false) and not coalesce(is_membership,false) and not coalesce(is_topup,false);
  v_base    := v_days14 / (14.0 * 48.0);
  v_min_ord := coalesce((s.automation->'peak'->>'min')::int, 4);
  v_mult    := coalesce((s.automation->'peak'->>'mult')::numeric, 3);
  v_peak_now := v_recent >= greatest(v_min_ord, ceil(v_base * v_mult));

  v_loc := s.shop_locations->0;
  return jsonb_build_object(
    'automation', s.automation, 'store_open', s.store_open, 'delivery_mode', s.delivery_mode,
    'open_now', v_open_now, 'peak_now', v_peak_now, 'recent_orders', v_recent,
    'shop_lat', (v_loc->>'lat'), 'shop_lng', (v_loc->>'lng'));
end; $$;
