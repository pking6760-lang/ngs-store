-- ════════════════════════════════════════════════════════════════════════════
-- Dial the daily notifications back to 8 a day (from 12), spread evenly:
--   08 morning · 10 playful · 12 lunch · 14 afternoon · 16 teasing ·
--   18 evening · 20 dinner · 21 night
-- Weather + festival messages still fire on top on the days they apply.
-- ════════════════════════════════════════════════════════════════════════════

-- Turn off the extra slots.
update public.notification_campaigns set enabled = false
  where bucket in ('forgot','alone','travel','urgent')
    and dow is null and on_date is null;

-- Re-time the keepers for an even ~2-hour spread.
update public.notification_campaigns set enabled = true, hour_ist = 10
  where bucket = 'playful' and dow is null and on_date is null;
update public.notification_campaigns set enabled = true, hour_ist = 16
  where bucket = 'teasing' and dow is null and on_date is null;
update public.notification_campaigns set enabled = true, hour_ist = 20
  where bucket = 'dinner'  and dow is null and on_date is null;

-- Keep the rest on at their existing times.
update public.notification_campaigns set enabled = true
  where bucket in ('morning','lunch','afternoon','evening','night')
    and dow is null and on_date is null;
