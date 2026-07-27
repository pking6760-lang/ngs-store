-- Know before it breaks.
--
-- Growth doesn't announce itself. The shop is fine at 50 users a day and the
-- same code falls over at 5,000, and the day it happens is a Sunday evening with
-- orders on the floor. So the database checks its own capacity every morning and
-- says, in plain words, what to do and when.
--
-- Every threshold below is set from something measured on this project, not
-- guessed -- see docs/SCALING.md for the numbers and where they came from.

begin;

-- What the shop looks like right now, in the numbers that actually decide when
-- something has to change. Admin-only: it is a business summary.
create or replace function public.capacity_report()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_db bigint; v_orders_7d int; v_orders_1d int; v_actives int; v_customers int;
  v_catalogue bigint; v_products int; v_biggest text; v_biggest_rows bigint;
  v_unindexed int; v_scanned jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  select pg_database_size(current_database()) into v_db;
  select count(*) into v_orders_7d from public.orders where created_at >= now() - interval '7 days';
  select count(*) into v_orders_1d from public.orders where created_at >= now() - interval '1 day';
  select count(distinct user_id) into v_actives
    from public.orders where created_at >= now() - interval '30 days';
  select count(*) into v_customers from public.profiles where role = 'customer';

  -- What every customer downloads to see the shop. This is the number that
  -- turns a big catalogue into a slow app.
  select count(*), coalesce(sum(
           octet_length(coalesce(name,'')) + octet_length(coalesce(image_url,'')) +
           octet_length(coalesce(bulk_tiers::text,'')) + 350), 0)
    into v_products, v_catalogue from public.products where active;

  select relname, n_live_tup into v_biggest, v_biggest_rows
    from pg_stat_user_tables where schemaname = 'public'
    order by n_live_tup desc limit 1;

  -- A foreign key with no index behind it is the classic way a fast screen
  -- quietly turns into a slow one as rows pile up.
  select count(*) into v_unindexed
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
       and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey);

  -- Big tables being read end-to-end instead of by index.
  select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup,
                                               'full_reads', seq_scan)), '[]'::jsonb)
    into v_scanned
    from pg_stat_user_tables
   where schemaname = 'public' and n_live_tup > 50000 and seq_scan > 1000;

  return jsonb_build_object(
    'dbBytes',        v_db,
    'dbPctOfFree',    round(v_db * 100.0 / (500 * 1024 * 1024)),
    'customers',      v_customers,
    'activeCustomers30d', v_actives,
    'orders1d',       v_orders_1d,
    'orders7d',       v_orders_7d,
    'products',       v_products,
    'catalogueBytes', v_catalogue,
    'unindexedFks',   v_unindexed,
    'tableScans',     v_scanned,
    'biggestTable',   v_biggest,
    'biggestRows',    v_biggest_rows);
end $$;

revoke all on function public.capacity_report() from public, anon;
grant execute on function public.capacity_report() to authenticated;

-- The morning check. Says what to do, not just what is wrong.
create or replace function public.run_capacity_watch()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_db bigint; v_orders_1d int; v_actives int; v_catalogue bigint; v_products int;
  v_unindexed int; v_scanned text; v_msg text := '';
begin
  select pg_database_size(current_database()) into v_db;
  select count(*) into v_orders_1d from public.orders where created_at >= now() - interval '1 day';
  select count(distinct user_id) into v_actives
    from public.orders where created_at >= now() - interval '30 days';
  select count(*), coalesce(sum(octet_length(coalesce(name,'')) +
         octet_length(coalesce(image_url,'')) + 350), 0)
    into v_products, v_catalogue from public.products where active;

  -- Storage. The free plan stops at 500 MB and does not warn gently.
  if v_db > 400 * 1024 * 1024 then
    v_msg := v_msg || 'Database is ' || round(v_db/1024.0/1024) ||
             ' MB of the 500 MB free limit — time to move to the paid plan. ';
  elsif v_db > 300 * 1024 * 1024 then
    v_msg := v_msg || 'Database is ' || round(v_db/1024.0/1024) ||
             ' MB (60% of the free limit). Plan the upgrade this month. ';
  end if;

  -- Traffic. 200 orders a day is roughly where the smallest instance stops
  -- being comfortable on this app's read pattern.
  if v_orders_1d >= 200 then
    v_msg := v_msg || v_orders_1d || ' orders yesterday — move the database to the ' ||
             'Small instance (about ₹1,300/month) before the next busy day. ';
  elsif v_actives >= 1000 then
    v_msg := v_msg || v_actives || ' customers ordered in the last 30 days — ' ||
             'you are past what the free instance is meant for. ';
  end if;

  -- The catalogue every phone downloads.
  if v_catalogue > 2 * 1024 * 1024 then
    v_msg := v_msg || 'The product list is ' || round(v_catalogue/1024.0/1024, 1) ||
             ' MB for ' || v_products || ' items — the app will feel slow on a weak signal. ';
  end if;

  select count(*) into v_unindexed
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
       and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey);
  if v_unindexed > 0 then
    v_msg := v_msg || v_unindexed || ' new table link(s) have no index — screens using them will get slower as rows build up. ';
  end if;

  select string_agg(relname, ', ') into v_scanned
    from pg_stat_user_tables
   where schemaname = 'public' and n_live_tup > 50000 and seq_scan > 10000;
  if v_scanned is not null then
    v_msg := v_msg || 'These tables are being read end-to-end: ' || v_scanned || '. They need an index. ';
  end if;

  if v_msg <> '' then
    insert into public.notifications (user_id, title, body)
      select id, '📈 Growing — action needed', v_msg from public.profiles where role = 'admin';
  end if;
end $$;

revoke all on function public.run_capacity_watch() from public, anon, authenticated;

commit;

-- 06:00 IST, before the shop opens.
select cron.schedule('capacity-watch', '30 0 * * *', 'select public.run_capacity_watch()');
