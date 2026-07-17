-- ════════════════════════════════════════════════════════════════════════════
-- Real-time weather notifications, keyed on each CUSTOMER's own location.
--   • A weather-notify Edge Function reads every customer's default-address
--     lat/lng, batches them by area, asks Open-Meteo for the current weather,
--     and picks a bucket: 'rain' (raining), 'hot' (too hot), 'cold' (cold).
--   • send_weather_bucket() drops a random matching message into public.
--     notifications for those users — which the existing notify-customer
--     trigger pushes to their phones.
--   • weather_sends dedupes: a customer gets at most ONE message per bucket
--     per day (IST), so we never spam.
--   • pg_cron pokes the function a few times through the day.
-- ════════════════════════════════════════════════════════════════════════════

-- Per-user, per-bucket, per-day guard so nobody gets the same weather nudge twice.
create table if not exists public.weather_sends (
  user_id   uuid not null references auth.users(id) on delete cascade,
  bucket    text not null,
  sent_date date not null,
  primary key (user_id, bucket, sent_date)
);
alter table public.weather_sends enable row level security;   -- no policies → clients can't touch it
revoke all on public.weather_sends from anon, authenticated;

-- Customers with a usable location (default address preferred). Service-role
-- only — the Edge Function calls this to know where everyone is.
create or replace function public.weather_customer_locations()
 returns table(user_id uuid, lat double precision, lng double precision)
 language sql security definer set search_path to 'public' as $function$
  select distinct on (p.id)
    p.id,
    (a.location->>'lat')::double precision,
    (a.location->>'lng')::double precision
  from public.profiles p
  join public.customer_addresses a on a.user_id = p.id
  where p.role = 'customer'
    and a.location is not null
    and coalesce(a.location->>'lat','') <> ''
    and coalesce(a.location->>'lng','') <> ''
  order by p.id, a.is_default desc, a.created_at desc;
$function$;
revoke execute on function public.weather_customer_locations() from public, anon, authenticated;

-- Send a weather bucket to a set of users. Each eligible user (not already sent
-- this bucket today) gets a random active template from that bucket. Returns
-- the number actually notified. Service-role only.
create or replace function public.send_weather_bucket(p_bucket text, p_user_ids uuid[])
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_count int;
begin
  with sent as (
    insert into public.notifications (user_id, title, body)
    select u, t.title, t.body
    from unnest(p_user_ids) as u
    cross join lateral (
      select title, body from public.notification_templates
      where bucket = p_bucket and active order by random() limit 1
    ) t
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

-- Cron poke → weather-notify Edge Function (reads the shared webhook secret).
create or replace function public.run_weather_notify()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/weather-notify',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then null;
end; $function$;
revoke execute on function public.run_weather_notify() from public, anon, authenticated;

-- A few checks through the day (UTC → IST: 03:00≈08:30, 06:00≈11:30,
-- 09:00≈14:30, 12:00≈17:30, 14:00≈19:30). The function dedupes per user/day,
-- so re-running catches weather that turns later in the day without spamming.
select cron.unschedule('weather-notify') where exists (select 1 from cron.job where jobname='weather-notify');
select cron.schedule('weather-notify', '0 3,6,9,12,14 * * *', 'select public.run_weather_notify()');

-- ── Starter weather templates (Hinglish, short, matching emoji) ──────────────
insert into public.notification_templates (bucket, title, body) values
  ('rain', 'Barish shuru! ☔',        'Bahar nikalna mushkil? Grocery hum laayenge — aap chai-pakode enjoy karo. 🌧️'),
  ('rain', 'Mausam suhana 🌦️',        'Aaj barish ka din! Zaroorat ka saamaan ghar baithe mangao NGS se. ☔'),
  ('hot',  'Garmi se raahat 🥵',      'Bahar dhoop tez hai! Thanda pani, cold drinks, ice cream — 10 min me ghar par. 🧊'),
  ('hot',  'Loo chal rahi hai 🌡️',    'Bahar mat jao — thandi cheezein NGS se mangao, hum laayenge. 🥤'),
  ('hot',  'Aaj bahut garmi hai ☀️',  'AC on karo, baaki sab hum sambhaal lenge — grocery NGS se ghar par. 🧴'),
  ('cold', 'Thand aa gayi ❄️',        'Bahar sardi hai! Garam chai, soup, adrak — sab NGS se, ghar baithe. ☕'),
  ('cold', 'Kadake ki thand 🥶',      'Rajai se bahar mat aao — zaroorat ka saara saamaan NGS laayega. 🧣'),
  ('cold', 'Sardi ka mausam 🌫️',      'Garam-garam cheezein aur roz ka saamaan — sab NGS se, warm raho. ♨️')
on conflict do nothing;
