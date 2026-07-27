-- Storing the same information in less space.
--
-- WHAT WAS MEASURED FIRST (this matters -- the obvious suspects were wrong):
--
--   the whole business database, every order, product and customer   6.5 MB
--   cron.job_run_details, a log of every scheduled job that has run   9.8 MB
--
-- The biggest table in the project is a log nobody has ever read. The dispatch
-- tick runs every 30 seconds and each run writes a row: 4,259 rows a day, on
-- course for 1.5 million rows and about 205 MB a year. Postgres does not clean
-- it up on its own.
--
-- An order itself is 431 bytes and an order line 93, so a three-line order is
-- about 700 bytes of data. At a thousand orders a day that is 365 MB a year --
-- real, but the books are worth keeping and the fat is not in them.
--
-- Where the fat IS, inside those 431 bytes:
--   location (jsonb)   98 bytes   two numbers stored as text with braces
--   17 text columns   205 bytes   including short repeated words like 'Delivered'
--   19 numeric        81 bytes    money
--   6 uuid            80 bytes    unavoidable
--
-- This migration takes the two safe ones: the log, and the location. It does NOT
-- touch the money columns. Changing numeric to integer would save about 30 bytes
-- an order and put every price, refund and payout through a type conversion --
-- a rounding bug there costs more than a decade of the storage it saves.

begin;

-- ── 1. The log ───────────────────────────────────────────────────────────────
-- Three days is enough to answer "did last night's job run?", which is the only
-- question anyone asks of it.
create or replace function public.run_retention()
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  -- Campaign send-logs: they only exist to stop the same customer being messaged
  -- twice, so a season of history is more than enough.
  delete from public.reorder_sends  where sent_date < current_date - 120;
  delete from public.winback_sends  where sent_date < current_date - 120;
  delete from public.weather_sends  where sent_date < current_date - 120;
  -- One-time codes and presence heartbeats: minutes matter, months don't.
  delete from public.partner_otps   where created_at < now() - interval '7 days';
  delete from public.partner_online_log where started_at < now() - interval '90 days';
  -- The scheduler's own run log — the largest table in the project, and pure
  -- noise after a few days.
  begin
    delete from cron.job_run_details where end_time < now() - interval '3 days';
  exception when others then null;   -- not fatal if the extension moves
  end;
end $$;

revoke all on function public.run_retention() from public, anon, authenticated;

-- ── 2. Where the order was delivered ─────────────────────────────────────────
-- Stored as jsonb: {"lat": 28.49563597918241, "lng": 77.16211614418259, ...}.
-- That is 98 bytes to hold two numbers, because jsonb keeps the key names and
-- the full text of every digit on every row.
--
-- Two float8 columns hold the same two numbers in 16 bytes, and float8 keeps
-- about 15 significant digits — far past the ~1 cm that the 8th decimal place
-- represents. Nothing about a delivery needs more precision than a doorway.
alter table public.orders
  add column if not exists lat double precision,
  add column if not exists lng double precision;

update public.orders
   set lat = (location->>'lat')::double precision,
       lng = (location->>'lng')::double precision
 where location is not null and lat is null;

comment on column public.orders.lat is 'Delivery point. Replaces the lat/lng that used to live inside the location jsonb — same numbers, 16 bytes instead of 98.';

-- Keep both in step while old app versions are still installed and writing the
-- jsonb: whichever one an app fills, the other follows.
create or replace function public.sync_order_location()
returns trigger language plpgsql as $$
begin
  if new.location is not null and (new.lat is null or new.lng is null) then
    new.lat := (new.location->>'lat')::double precision;
    new.lng := (new.location->>'lng')::double precision;
  elsif new.lat is not null and new.location is null then
    new.location := jsonb_build_object('lat', new.lat, 'lng', new.lng);
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_order_location on public.orders;
create trigger trg_sync_order_location
  before insert or update of location, lat, lng on public.orders
  for each row execute function public.sync_order_location();

commit;

-- ── 3. Reclaim what is already wasted ────────────────────────────────────────
-- Rolled-back test transactions and ordinary updates leave dead rows behind, and
-- the space is only returned when the table is rewritten. order_items' primary
-- key was 272 kB for 77 rows of data.
vacuum (analyze) public.orders;
vacuum (analyze) public.order_items;
vacuum (analyze) public.notifications;
vacuum (analyze) public.products;
reindex table public.order_items;
reindex table public.orders;
reindex table public.notifications;
