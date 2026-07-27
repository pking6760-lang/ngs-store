-- One small signal instead of a broadcast to everybody.
--
-- THE PROBLEM, measured on the live database:
--
-- Every open app subscribed to whole TABLES -- products, categories, settings,
-- coupons, orders, notifications -- and re-fetched everything on any change made
-- by anyone. The catalogue fetch alone is 76 KB for 118 products.
--
-- So the cost was writes x users, not writes + users:
--   * the repricer touches all 118 products every 6 hours. Each row is a separate
--     event, so one run made every phone in the city re-download the catalogue
--     118 times. At 5,000 users that is 590,000 fetches, 45 GB, from one cron job.
--   * one customer placing an order woke up every other customer's app, because
--     they were all listening to the whole orders table.
--   * on top of that each app polled 7 tables every 30 seconds no matter what.
--     1,000 open apps = 14,000 requests a minute with nobody touching anything.
--
-- The database is not what breaks first; the request storm is. On the current
-- instance this design falls over somewhere around 300-800 concurrent users --
-- not the 50,000 we want to be ready for.
--
-- THE FIX, in three parts:
--   1. this table -- a single row of counters. A statement-level trigger bumps a
--      counter ONCE per statement, so the repricer's 118-row update produces one
--      event of a few bytes instead of 118 events of 76 KB each.
--   2. the catalogue tables come OUT of the realtime publication. Nothing needs
--      row-by-row news about them; they need "something changed, re-read when
--      you like". Less WAL to decode too, which was already the single biggest
--      CPU consumer on the instance (5,359 seconds of decoding).
--   3. what stays published (orders, notifications) is subscribed to by the
--      clients WITH A user_id FILTER, so one customer's order no longer wakes
--      up every other customer.

begin;

create table if not exists public.catalog_state (
  id           int primary key default 1 check (id = 1),
  products_v   bigint not null default 0,
  categories_v bigint not null default 0,
  settings_v   bigint not null default 0,
  coupons_v    bigint not null default 0,
  themes_v     bigint not null default 0,
  updated_at   timestamptz not null default now()
);
insert into public.catalog_state (id) values (1) on conflict (id) do nothing;

comment on table public.catalog_state is
  'One row of counters. Each is bumped once per statement that changes the matching table, so clients can tell "the catalogue moved" from a few bytes instead of re-reading everything on every row.';

alter table public.catalog_state enable row level security;
drop policy if exists catalog_state_read on public.catalog_state;
-- Readable by everyone: it is four integers and a timestamp, no business data.
create policy catalog_state_read on public.catalog_state for select using (true);
-- Nobody writes it directly. Only the triggers below, which run as the owner.
revoke insert, update, delete on public.catalog_state from anon, authenticated;
grant select on public.catalog_state to anon, authenticated;

create or replace function public.bump_catalog_state()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  execute format('update public.catalog_state set %I = %I + 1, updated_at = now() where id = 1',
                 tg_argv[0], tg_argv[0]);
  return null;
end $$;

-- FOR EACH STATEMENT, not FOR EACH ROW. That is the whole point: the repricer's
-- single UPDATE over 118 products has to produce exactly one bump.
drop trigger if exists trg_bump_products on public.products;
create trigger trg_bump_products after insert or update or delete or truncate on public.products
  for each statement execute function public.bump_catalog_state('products_v');

drop trigger if exists trg_bump_categories on public.categories;
create trigger trg_bump_categories after insert or update or delete or truncate on public.categories
  for each statement execute function public.bump_catalog_state('categories_v');

drop trigger if exists trg_bump_settings on public.settings;
create trigger trg_bump_settings after insert or update or delete on public.settings
  for each statement execute function public.bump_catalog_state('settings_v');

drop trigger if exists trg_bump_coupons on public.coupons;
create trigger trg_bump_coupons after insert or update or delete or truncate on public.coupons
  for each statement execute function public.bump_catalog_state('coupons_v');

drop trigger if exists trg_bump_themes on public.customer_themes;
create trigger trg_bump_themes after insert or update or delete or truncate on public.customer_themes
  for each statement execute function public.bump_catalog_state('themes_v');

-- Publish the signal; unpublish everything it replaces, plus the tables no app
-- was listening to at all. Every table left in the publication has a real
-- subscriber that needs row-level news: orders and order_items (the shop floor),
-- notifications and calls (per user, filtered), and the partner/payout tables.
alter publication supabase_realtime add table public.catalog_state;
alter publication supabase_realtime drop table public.products;
alter publication supabase_realtime drop table public.categories;
alter publication supabase_realtime drop table public.settings;
alter publication supabase_realtime drop table public.coupons;
alter publication supabase_realtime drop table public.ops_config;
alter publication supabase_realtime drop table public.product_ops;
alter publication supabase_realtime drop table public.admin_push_tokens;
-- profiles changes on every single order (order_count), and only the admin
-- customer list was listening. It refreshes on focus and on its timer instead.
alter publication supabase_realtime drop table public.profiles;

commit;
