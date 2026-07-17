-- ════════════════════════════════════════════════════════════════════════════
-- Auto-notify v2:
--   1. No repetition — pick the LEAST-RECENTLY-SENT active message in a bucket
--      (rotate through the whole bank before repeating), via _pick_template().
--   2. Fixed-date festivals auto-repeat every year — recur_md matches on
--      month+day, so "15 Aug" fires every year with no manual re-setting.
--   3. New buckets: mood/occasion (playful, teasing, urgent, forgot, alone,
--      travel) + fixed national days (independence_day, gandhi_jayanti,
--      republic_day, makar_sankranti, new_year_eve, christmas).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.notification_templates  add column if not exists last_sent_at timestamptz;
alter table public.notification_campaigns   add column if not exists recur_md boolean not null default false;

-- Rotation picker: least-recently-sent active template in a bucket, then stamp
-- it as sent so the next call moves on. Rotates the whole bank before repeating.
create or replace function public._pick_template(p_bucket text)
 returns table(title text, body text) language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint;
begin
  select id into v_id from public.notification_templates
    where bucket = p_bucket and active
    order by last_sent_at asc nulls first, random()
    limit 1;
  if v_id is null then return; end if;
  update public.notification_templates set last_sent_at = now() where id = v_id;
  return query select t.title, t.body from public.notification_templates t where t.id = v_id;
end; $function$;
revoke execute on function public._pick_template(text) from public, anon, authenticated;

-- Engine: fire due campaigns. on_date now supports yearly recurrence (recur_md
-- → match month+day, ignore the year) so fixed holidays repeat automatically.
create or replace function public.run_notification_campaigns()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare c record; v_tpl record; v_hour int; v_dow int; v_date date; v_sent int := 0;
begin
  v_hour := extract(hour from (now() at time zone 'Asia/Kolkata'))::int;
  v_dow  := extract(dow  from (now() at time zone 'Asia/Kolkata'))::int;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  for c in
    select * from public.notification_campaigns
    where enabled and hour_ist = v_hour
      and (dow is null or dow = v_dow)
      and (
        on_date is null
        or (recur_md and to_char(on_date,'MM-DD') = to_char(v_date,'MM-DD'))
        or (not recur_md and on_date = v_date)
      )
      and (last_run is null or last_run < v_date)
  loop
    select * into v_tpl from public._pick_template(c.bucket);
    if v_tpl.title is not null then
      insert into public.notifications (user_id, title, body)
        select id, v_tpl.title, v_tpl.body from public.profiles where role = 'customer';
      v_sent := v_sent + 1;
    end if;
    update public.notification_campaigns set last_run = v_date where id = c.id;
  end loop;
  return v_sent;
end; $function$;
revoke execute on function public.run_notification_campaigns() from public, anon, authenticated;

-- Manual "Send now" — also rotates (no more repeats when tapped repeatedly).
create or replace function public.send_bucket_now(p_bucket text)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_tpl record; v_count int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into v_tpl from public._pick_template(p_bucket);
  if v_tpl.title is null then raise exception 'No active message in that group yet.'; end if;
  insert into public.notifications (user_id, title, body)
    select id, v_tpl.title, v_tpl.body from public.profiles where role = 'customer';
  get diagnostics v_count = row_count;
  return v_count;
end; $function$;
revoke execute on function public.send_bucket_now(text) from public, anon;
grant execute on function public.send_bucket_now(text) to authenticated;

-- Weather sender — one rotated message per bucket per run (still deduped per
-- user/day). Everyone due gets that message; the next occurrence rotates on.
create or replace function public.send_weather_bucket(p_bucket text, p_user_ids uuid[])
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_tpl record; v_count int;
begin
  select * into v_tpl from public._pick_template(p_bucket);
  if v_tpl.title is null then return 0; end if;
  with sent as (
    insert into public.notifications (user_id, title, body)
    select u, v_tpl.title, v_tpl.body
    from unnest(p_user_ids) as u
    where not exists (
      select 1 from public.weather_sends w
      where w.user_id = u and w.bucket = p_bucket and w.sent_date = v_today
    )
    returning user_id
  ),
  logged as (
    insert into public.weather_sends (user_id, bucket, sent_date)
    select user_id, p_bucket, v_today from sent
    on conflict do nothing
    returning user_id
  )
  select count(*) into v_count from logged;
  return coalesce(v_count, 0);
end; $function$;
revoke execute on function public.send_weather_bucket(text, uuid[]) from public, anon, authenticated;

-- ── Fixed-date campaigns → auto-repeat every year (month+day). ONLY the truly
--    fixed ones. Lunar festivals (Holi, Diwali, …) shift yearly, so they stay
--    recur_md = false and the admin updates their date once a year. ───────────
update public.notification_campaigns set recur_md = true
  where bucket in ('new_year','spring','summer','autumn','winter','rain')
    and on_date is not null;

-- ── New fixed-date national days (recur every year on month+day) ─────────────
insert into public.notification_campaigns (label, bucket, hour_ist, dow, on_date, enabled, recur_md) values
  ('Makar Sankranti',   'makar_sankranti', 9, null, date '2027-01-14', true, true),
  ('Republic Day',      'republic_day',    9, null, date '2027-01-26', true, true),
  ('Independence Day',  'independence_day',9, null, date '2026-08-15', true, true),
  ('Gandhi Jayanti',    'gandhi_jayanti',  9, null, date '2026-10-02', true, true),
  ('Christmas',         'christmas',       9, null, date '2026-12-25', true, true),
  ('New Year''s Eve',   'new_year_eve',    18,null, date '2026-12-31', true, true)
on conflict do nothing;

-- ── Starter templates for the new buckets (Hinglish, short, matching emoji) ──
insert into public.notification_templates (bucket, title, body) values
  -- mood / occasion
  ('playful',  'Bhookh lagi? 😋',           'Pet me chuhe daud rahe hain? NGS se turant kuch mangwa lo! 🐭'),
  ('playful',  'Snack attack! 🍿',          'Man kar raha hai kuch chatpata? 10 min me ghar par, NGS se. 😄'),
  ('teasing',  'Fridge khaali? 👀',         'Roz bahar ka khaana... ghar ka saamaan bhi mangwa lo na! 😏'),
  ('teasing',  'Aalas aa raha? 😴',         'Uthne ka mann nahi? Koi baat nahi — NGS ghar tak laayega. 😎'),
  ('urgent',   'Jaldi karo! ⏳',            'Zaroorat ki cheezein abhi order karo — der mat karo! 🏃'),
  ('urgent',   'Last minute? ⚡',           'Kuch turant chahiye? NGS se 10 min me — abhi order karo! 🛵'),
  ('forgot',   'Kuch bhool gaye? 🤔',       'Doodh, bread, anda... kahin kuch reh to nahi gaya? NGS se mangao. 🛒'),
  ('forgot',   'Checklist adhoori? 📝',     'List me kuch chhoot gaya? Ek tap me poora karo, NGS par. ✅'),
  ('alone',    'Akele ho aaj? 🏠',          'Apne liye kuch acha order karo — comfort food NGS se, jaldi. 🍜'),
  ('alone',    'Me-time! 🛋️',              'Chill karo — chai, snacks, sab NGS laayega, aap aaram karo. ☕'),
  ('travel',   'Trip pe ja rahe? 🧳',       'Safar se pehle zaroorat ka saamaan pack karo — NGS se mangao. ✈️'),
  ('travel',   'Wapas aa gaye? 🚗',         'Ghar ka fridge khaali? Restock karo NGS se, 10 min me. 🧺'),
  -- fixed national days
  ('independence_day','Happy Independence Day 🇮🇳','Aazadi ka jashn mubarak! Tiranga mithai aur ghar ka saamaan NGS se. 🎉'),
  ('gandhi_jayanti',  'Gandhi Jayanti 🙏',        'Bapu ko naman. Aaj ka din shubh ho — zaroorat ka saamaan NGS par. 🕊️'),
  ('republic_day',    'Happy Republic Day 🇮🇳',    'Gantantra Diwas ki shubhkaamnaayein! Celebrate karo, grocery hum laayenge. 🎊'),
  ('makar_sankranti', 'Happy Makar Sankranti 🪁', 'Til-gud khao, patang udao! Tyohar ka saara saamaan NGS se. ☀️'),
  ('new_year_eve',    'New Year''s Eve 🎆',       'Party ki taiyari? Snacks, drinks, sab NGS se — 10 min me ghar par. 🥳'),
  ('christmas',       'Merry Christmas 🎄',       'Santa aa raha hai! Cake, chocolates aur gifts NGS se. 🎅')
on conflict do nothing;
