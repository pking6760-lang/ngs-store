-- ════════════════════════════════════════════════════════════════════════════
-- Make rain-surge reliable. The raw Open-Meteo reading flickers around the light
-- threshold, so surge was flapping on/off every tick. Add a small debounce: rain
-- must persist for a couple of ticks before surge turns ON, and stay dry a couple
-- of ticks before it turns OFF. State lives in settings.wx_wet (0..2).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings add column if not exists wx_wet smallint not null default 0;

-- Feed in the raw "is it raining now" and get back the DEBOUNCED answer.
--   raw wet  → streak up to 2;  raw dry → streak down to 0
--   raining = streak >= 2  (needs 2 consecutive wet reads to flip on, 2 dry to flip off)
create or replace function public.weather_debounce(p_raw boolean)
 returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  select coalesce(wx_wet, 0) into v from public.settings where id = 1;
  if p_raw then v := least(v + 1, 2); else v := greatest(v - 1, 0); end if;
  update public.settings set wx_wet = v where id = 1;
  return v >= 2;
end; $$;
grant execute on function public.weather_debounce(boolean) to service_role;

-- Clear any stale manual hold so automation resumes control immediately.
update public.settings set auto_surge_hold_until = null where id = 1;

select 'surge hysteresis ready' as status;
