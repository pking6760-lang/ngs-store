-- Delete means delete, and a weekly tidy-up on the customer side.
--
-- WHAT WAS ACTUALLY WRONG (checked before writing anything):
--
-- Deleting from the admin app already removed the database row properly -- there
-- is no soft-delete hiding anywhere. But the product's PHOTO was left in storage
-- forever, and so was the old photo every time a product was re-photographed.
-- 11 orphaned images were already sitting there. Small today; it is the pattern
-- that matters, because it only ever grows and storage is billed.
--
-- The customer side had the opposite problem: nothing was ever tidied. Read
-- notifications sat for 90 days, and a customer's order list grew for life.
--
-- WHAT IS DELIBERATELY NOT DELETED: orders, order lines, wallet and points
-- ledgers, payouts. Those are the books -- they are needed for refunds, GST and
-- the profit numbers every pricing decision in this app is built on. What
-- changes is that the CUSTOMER stops seeing old ones; the shop's copy stays.
-- An order takes about 9 KB, so a year of them is a few hundred megabytes even
-- at a thousand a day, and the cost of losing them cannot be undone.

begin;

-- ── 1. Deleting a product takes its photo with it ────────────────────────────
--
-- Storage files cannot be removed from SQL alone (the row here is only the
-- index; the file itself lives in object storage). So the database records what
-- should go, and the sweep below -- which runs with the storage service's own
-- delete -- removes them. Recording it here means a photo is never missed even
-- if the admin app is closed mid-delete or the phone loses signal.
create table if not exists public.storage_gc (
  id         bigserial primary key,
  bucket     text not null,
  name       text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (bucket, name)
);
alter table public.storage_gc enable row level security;
revoke all on public.storage_gc from anon, authenticated;

comment on table public.storage_gc is
  'Files whose owning row is gone. Emptied by the storage sweep, which is the only thing that can delete the file itself.';

create or replace function public.mark_product_image_gone()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_old text; v_new text;
begin
  v_old := case when tg_op = 'DELETE' then old.image_url else old.image_url end;
  v_new := case when tg_op = 'DELETE' then null else new.image_url end;
  -- Nothing to do when the photo did not change.
  if v_old is null or v_old is not distinct from v_new then return coalesce(new, old); end if;
  if v_old like '%/product-images/%' then
    insert into public.storage_gc (bucket, name, reason)
    values ('product-images', regexp_replace(v_old, '^.*/product-images/', ''),
            case when tg_op = 'DELETE' then 'product deleted' else 'photo replaced' end)
    on conflict (bucket, name) do nothing;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_product_image_gc on public.products;
create trigger trg_product_image_gc
  after update of image_url or delete on public.products
  for each row execute function public.mark_product_image_gone();

-- REMOVED, and see migration-gc-bug-fix.sql for why.
--
-- This block swept the whole bucket for files "no product references" and queued
-- them. Category photos live in the same bucket (cat<timestamp>.jpg), so all
-- nine of them matched and were deleted. The assumption — one bucket, one owner
-- — was wrong, and a delete is the one thing that cannot be taken back.
--
-- Nothing replaces it. Files are now only ever queued one at a time, by the
-- trigger above, for the product that owned them.

-- What the sweep should delete. Admin-only; the sweeper reads it with the
-- service key and reports back.
create or replace function public.storage_gc_list(p_limit int default 200)
returns table (bucket text, name text)
language sql stable security definer set search_path to 'public'
as $$
  select g.bucket, g.name from public.storage_gc g
   where public.is_admin() order by g.id limit greatest(coalesce(p_limit, 200), 1)
$$;

create or replace function public.storage_gc_done(p_bucket text, p_names text[])
returns int
language plpgsql security definer set search_path to 'public'
as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.storage_gc where bucket = p_bucket and name = any(p_names);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.storage_gc_list(int) from public, anon;
revoke all on function public.storage_gc_done(text, text[]) from public, anon;
grant execute on function public.storage_gc_list(int) to authenticated;
grant execute on function public.storage_gc_done(text, text[]) to authenticated;

-- ── 2. The customer's own history stops growing ──────────────────────────────
--
-- The order stays in the books; it simply drops off the customer's list, the
-- same way a shop's receipt drawer is not the customer's problem.
alter table public.orders
  add column if not exists hidden_for_customer boolean not null default false;

comment on column public.orders.hidden_for_customer is
  'Aged out of the customer''s own order list by the weekly clean-up. The order itself is untouched -- admin, accounts and refunds still see it in full.';

create index if not exists idx_orders_user_visible on public.orders (user_id, created_at desc)
  where not hidden_for_customer;

-- ── 3. The weekly clean-up ───────────────────────────────────────────────────
create or replace function public.run_weekly_customer_clean()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_notes int; v_orders int;
begin
  -- Notifications are disposable. Read ones go after a week, unread after a
  -- month -- nobody opens a month-old "your order is on the way".
  delete from public.notifications
   where (read and created_at < now() - interval '7 days')
      or created_at < now() - interval '30 days';
  get diagnostics v_notes = row_count;

  -- Finished orders older than 90 days leave the customer's list.
  update public.orders set hidden_for_customer = true
   where not hidden_for_customer
     and created_at < now() - interval '90 days'
     and status in ('Delivered', 'Cancelled', 'Returned');
  get diagnostics v_orders = row_count;

  -- Saved carts nobody came back to.
  delete from public.carts where updated_at < now() - interval '30 days';

  return jsonb_build_object('notifications', v_notes, 'ordersHidden', v_orders);
end $$;

revoke all on function public.run_weekly_customer_clean() from public, anon, authenticated;

commit;

-- Sunday 03:30 IST.
select cron.schedule('weekly-customer-clean', '0 22 * * 6',
                     'select public.run_weekly_customer_clean()');
