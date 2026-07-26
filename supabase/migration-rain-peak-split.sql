-- Rain and peak are two surcharges funding two different people.
--
-- They were one 'surge' mode, and its whole bonus went to the rider. So a
-- peak-hour surcharge paid the driver for someone else's work: a busy hour is
-- packing pressure, not weather. The picker carried it and got nothing.
--
--   RAIN  surcharge -> rider bonus   (they are the one out in it)
--   PEAK  surcharge -> picker bonus  (they are the one under the pressure)
--
-- delivery_mode is now 'normal' | 'rain' | 'peak' | 'both'. The old value
-- 'surge' is still read as rain, so nothing breaks on a shift already running.
--
-- The store automation already knew which was which -- it computed `raining`
-- and `peak_now` separately and then collapsed them into one boolean on the way
-- in. It now passes both through.

begin;

alter table public.ops_config
  add column if not exists peak_fee   numeric not null default 15,
  add column if not exists rain_bonus numeric not null default 12;

comment on column public.ops_config.peak_fee   is 'Customer surcharge during peak hours. Funds the PICKER''s peak bonus.';
comment on column public.ops_config.rain_bonus is 'Paid to the RIDER on every order placed while it is raining.';
comment on column public.ops_config.peak_bonus is 'Paid to the PICKER on every order placed during peak hours.';
comment on column public.ops_config.surge_fee  is 'Customer surcharge while raining. Funds the RIDER''s rain bonus.';

-- Pass rain and peak through separately instead of one collapsed flag.
create or replace function public.store_automation_apply(p_open boolean,
                                                         p_rain boolean,
                                                         p_peak boolean)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare s public.settings; v_mode text; v_did_open boolean := false; v_did_mode boolean := false;
begin
  perform set_config('ngs.auto', '1', true);   -- mark our writes as automation
  select * into s from public.settings where id = 1;

  if coalesce((s.automation->'hours'->>'on')::boolean, false)
     and (s.auto_hours_hold_until is null or now() >= s.auto_hours_hold_until)
     and s.store_open is distinct from p_open then
    update public.settings set store_open = p_open where id = 1;
    v_did_open := true;
  end if;

  -- Only the triggers the owner switched on may drive the mode. A rain reading
  -- cannot turn on peak pay, and vice versa.
  if (coalesce((s.automation->'rain'->>'on')::boolean, false)
      or coalesce((s.automation->'peak'->>'on')::boolean, false))
     and (s.auto_surge_hold_until is null or now() >= s.auto_surge_hold_until) then
    v_mode := case
      when p_rain and p_peak then 'both'
      when p_rain            then 'rain'
      when p_peak            then 'peak'
      else                        'normal' end;
    if s.delivery_mode is distinct from v_mode then
      update public.settings set delivery_mode = v_mode where id = 1;
      v_did_mode := true;
    end if;
  end if;

  return jsonb_build_object('changed_open', v_did_open, 'changed_mode', v_did_mode,
                            'store_open', p_open, 'rain', p_rain, 'peak', p_peak,
                            'mode', v_mode);
end; $$;

-- Old two-argument form kept so an in-flight edge function keeps working; it
-- reads the single flag as rain, matching the previous rider-only behaviour.
create or replace function public.store_automation_apply(p_open boolean, p_surge boolean)
returns jsonb
language sql security definer set search_path to 'public'
as $$ select public.store_automation_apply(p_open, p_surge, false); $$;

commit;

-- One flat surcharge, not one per condition (owner's call): rain Rs25,
-- peak Rs25, both Rs25. peak_fee is therefore not needed.
begin;
alter table public.ops_config drop column if exists peak_fee;
update public.ops_config set surge_fee = 25 where id = 1;
alter table public.orders add column if not exists surge_mode text;
comment on column public.orders.surge_mode is 'Which surcharge applied when the order was placed: rain / peak / both.';
-- Scratch cards stop landing on every order: a reward that always arrives is
-- just a discount the customer prices in.
update public.settings
   set rewards = jsonb_set(rewards, '{scratch,orderChancePct}', '40'::jsonb)
 where id = 1;
commit;
