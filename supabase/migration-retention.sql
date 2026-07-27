-- Tables that grow forever eventually stop working.
--
-- notifications is already the biggest table in the database: 842 rows in
-- eleven days across seven customers, which is about 11 a day each. That rate
-- with 5,000 customers is 55,000 rows a DAY, 20 million a year -- on a plan
-- whose whole database is 500 MB. Nobody reads a three-month-old notification,
-- so nothing of value is lost by not keeping it.
--
-- Deliberately NOT on this list: orders, order_items, wallet and points ledgers,
-- payouts. Those are the books. They get archived when they get big, never
-- deleted.

begin;

create or replace function public.run_retention()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  -- Read messages older than 90 days, and anything older than 180 days whether
  -- it was read or not.
  delete from public.notifications
   where (read and created_at < now() - interval '90 days')
      or created_at < now() - interval '180 days';
  get diagnostics v_n = row_count;

  -- Send-log tables: they exist only to stop the same customer being messaged
  -- twice in a campaign, so a season of history is more than enough.
  delete from public.reorder_sends  where sent_date < current_date - 120;
  delete from public.winback_sends  where sent_date < current_date - 120;
  delete from public.weather_sends  where sent_date < current_date - 120;
  -- Partner presence heartbeats and one-time codes: minutes matter, months don't.
  delete from public.partner_otps   where created_at < now() - interval '7 days';
  delete from public.partner_online_log where started_at < now() - interval '90 days';

  if v_n > 0 then
    raise notice 'retention: removed % notifications', v_n;
  end if;
end $$;

revoke all on function public.run_retention() from public, anon, authenticated;

commit;

-- 03:40 IST, when nothing else is running.
select cron.schedule('retention', '10 22 * * *', 'select public.run_retention()');
