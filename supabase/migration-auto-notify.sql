-- ════════════════════════════════════════════════════════════════════════════
-- Automated notification campaigns.
--   • notification_templates: a bank of messages, each tagged with a `bucket`
--     (morning, evening, diwali, sunday, birthday, …). Admin stores hundreds.
--   • notification_campaigns: schedule rules — "at hour H (IST), on day-of-week
--     D and/or date X, send a random message from bucket B to all customers".
--   • run_notification_campaigns(): the hourly engine. Fires each due campaign
--     once per day, picks a random active template, broadcasts it (→ push).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_templates (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  title      text not null,
  body       text default '',
  active     boolean default true,
  created_at timestamptz default now()
);
create index if not exists nt_bucket_idx on public.notification_templates (bucket) where active;

create table if not exists public.notification_campaigns (
  id         bigint generated always as identity primary key,
  label      text not null,
  bucket     text not null,
  hour_ist   smallint not null default 9,   -- 0–23, IST
  dow        smallint,                       -- 0=Sun..6=Sat; null = every day
  on_date    date,                           -- specific date (festivals); null = recurring
  enabled    boolean default true,
  last_run   date,
  created_at timestamptz default now()
);

alter table public.notification_templates enable row level security;
alter table public.notification_campaigns enable row level security;
drop policy if exists nt_admin on public.notification_templates;
drop policy if exists nc_admin on public.notification_campaigns;
create policy nt_admin on public.notification_templates for all using (public.is_admin()) with check (public.is_admin());
create policy nc_admin on public.notification_campaigns   for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.notification_templates, public.notification_campaigns from anon;

-- The engine. Runs hourly from cron; fires any campaign whose IST hour = now,
-- whose day/date matches, that hasn't already run today.
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
      and (on_date is null or on_date = v_date)
      and (last_run is null or last_run < v_date)
  loop
    select * into v_tpl from public.notification_templates
      where bucket = c.bucket and active order by random() limit 1;
    if v_tpl.id is not null then
      insert into public.notifications (user_id, title, body)
        select id, v_tpl.title, v_tpl.body from public.profiles where role = 'customer';
      v_sent := v_sent + 1;
    end if;
    update public.notification_campaigns set last_run = v_date where id = c.id;
  end loop;
  return v_sent;
end; $function$;
revoke execute on function public.run_notification_campaigns() from public, anon, authenticated;

-- Admin: bulk-import a batch of templates (paste AI-generated JSON array of
-- {bucket,title,body}).
create or replace function public.import_notification_templates(p_items jsonb)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.notification_templates (bucket, title, body)
    select trim(x->>'bucket'), trim(x->>'title'), coalesce(x->>'body','')
    from jsonb_array_elements(p_items) x
    where coalesce(trim(x->>'bucket'),'') <> '' and coalesce(trim(x->>'title'),'') <> '';
  get diagnostics v_count = row_count;
  return v_count;
end; $function$;
revoke execute on function public.import_notification_templates(jsonb) from public, anon;
grant execute on function public.import_notification_templates(jsonb) to authenticated;

-- Admin: send one bucket right now (test / manual blast) to all customers.
create or replace function public.send_bucket_now(p_bucket text)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_tpl record; v_count int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into v_tpl from public.notification_templates where bucket = p_bucket and active order by random() limit 1;
  if v_tpl.id is null then raise exception 'No active message in that group yet.'; end if;
  insert into public.notifications (user_id, title, body)
    select id, v_tpl.title, v_tpl.body from public.profiles where role = 'customer';
  get diagnostics v_count = row_count;
  return v_count;
end; $function$;
revoke execute on function public.send_bucket_now(text) from public, anon;
grant execute on function public.send_bucket_now(text) to authenticated;

-- Hourly schedule (checks IST inside the function).
select cron.unschedule('notification-campaigns') where exists (select 1 from cron.job where jobname='notification-campaigns');
select cron.schedule('notification-campaigns', '5 * * * *', 'select public.run_notification_campaigns()');

-- ── Seed campaigns (times in IST; admin can edit/enable/disable) ─────────────
insert into public.notification_campaigns (label, bucket, hour_ist, dow, on_date, enabled) values
  ('Good morning · daily',        'morning',     8,  null, null, true),
  ('Afternoon nudge · daily',     'afternoon',   14, null, null, false),
  ('Evening · daily',             'evening',     18, null, null, true),
  ('Night · daily',               'night',       21, null, null, false),
  ('Sunday special',              'sunday',      10, 0,    null, true),
  ('Saturday special',            'saturday',    10, 6,    null, false),
  -- Festivals (VERIFY & adjust the dates each year in the admin)
  ('New Year',                    'new_year',    9,  null, '2027-01-01', true),
  ('Holi',                        'holi',        9,  null, '2026-03-04', true),
  ('Raksha Bandhan',              'rakhi',       9,  null, '2026-08-28', true),
  ('Janmashtami',                 'janmashtami', 9,  null, '2026-09-04', true),
  ('Dussehra',                    'dussehra',    9,  null, '2026-10-20', true),
  ('Dhanteras',                   'dhanteras',   9,  null, '2026-11-06', true),
  ('Diwali',                      'diwali',      9,  null, '2026-11-08', true),
  ('Govardhan Puja',              'govardhan',   9,  null, '2026-11-09', true),
  ('Bhai Dooj',                   'bhai_dooj',   9,  null, '2026-11-10', true),
  ('Chhath Puja',                 'chhath',      9,  null, '2026-11-15', true)
on conflict do nothing;

-- ── Seed a few starter messages per group (Hindi-English mix, short) ─────────
insert into public.notification_templates (bucket, title, body) values
  ('morning',   'Good morning ☀️',            'Subah ki fresh shuruaat NGS ke saath! Aaj ka grocery order 10 min me ghar par. 🛒'),
  ('morning',   'Uth gaye? ☕',                'Chai ke saath breakfast ka saamaan short hai? NGS se turant mangao!'),
  ('afternoon', 'Lunch time 🍛',              'Dopahar ka khaana ready? Jo bhi missing hai, NGS se 10 min me paao.'),
  ('evening',   'Shaam ki chai ☕',           'Evening snacks aur chai ka intezaam ho gaya? NGS par sab kuch hazir!'),
  ('night',     'Dinner ready? 🌙',           'Raat ke khaane ka koi saamaan reh gaya? NGS abhi bhi khula hai!'),
  ('sunday',    'Happy Sunday 🎉',            'Chhutti ka din, aaram ka mood! Grocery hum laayenge — aap relax karo. 😎'),
  ('saturday',  'Weekend vibes 🛍️',          'Weekend stock-up time! Ghar ka saara saamaan NGS se, ek hi order me.'),
  ('new_year',  'Happy New Year 🎆',          'Naya saal, nayi shuruaat! NGS parivaar ki taraf se aapko dhero shubhkaamnaayein. 🎉'),
  ('holi',      'Happy Holi 🌈',              'Rangon ka tyohar mubarak! Gujiya, thandai, colours — sab NGS par ready. 🎨'),
  ('diwali',    'Happy Diwali 🪔',            'Deepon ka tyohar shubh ho! Diyas, snacks, gifts — sab kuch NGS se. ✨'),
  ('dhanteras', 'Shubh Dhanteras 🪙',         'Dhanteras ki hardik shubhkaamnaayein! Ghar ki har zaroorat NGS par.'),
  ('dussehra',  'Happy Dussehra 🏹',          'Buraai par acchai ki jeet mubarak! Tyohar ka saamaan NGS se mangao.'),
  ('rakhi',     'Happy Raksha Bandhan 🎀',    'Bhai-behen ke pyaar ka din! Mithai aur gifts NGS se — jaldi mangao.'),
  ('chhath',    'Happy Chhath Puja 🌅',       'Chhathi maiya ki kripa bani rahe! Puja ka saara saamaan NGS par.'),
  ('birthday',  'Happy Birthday 🎂',          'Aapko janamdin ki dher saari shubhkaamnaayein NGS parivaar ki taraf se! 🎉'),
  ('sad',       'We miss you 💚',             'Kaafi din se nahi aaye! Aapke liye ek chhota surprise wait kar raha hai NGS par.')
on conflict do nothing;
