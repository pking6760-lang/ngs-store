-- ============================================================================
-- NGS Store — secure backend schema (Supabase / Postgres)
-- ============================================================================
-- SECURITY MODEL, in one sentence:
--   The server owns every important number. The customer's phone can only ASK;
--   it can never SET prices, totals, points, coupons or order status.
--
-- How that is enforced:
--   1. Row-Level Security (RLS) is ON for every table. By default nobody can do
--      anything; each policy below opens the smallest possible hole.
--   2. Customers can READ the catalog/coupons/settings but can NEVER write them.
--   3. Customers can READ ONLY THEIR OWN orders / points / profile / inbox.
--   4. Orders are NOT inserted by the client. They go through place_order(),
--      a SECURITY DEFINER function that recomputes item prices, the discount,
--      delivery fee, the total and the reward points FROM THE DATABASE — it
--      ignores any price/total the phone sends. So editing the phone does
--      nothing: the server always uses its own numbers.
--   5. Points are written only by the server (place_order / admin). A trigger
--      blocks a customer from raising their own points / role / membership.
--   6. Admin actions require role = 'admin' on the caller's profile.
--
-- Run this whole file once in the Supabase SQL editor (see SUPABASE_SETUP.md).
-- It is safe to re-run: it uses "if not exists" / "create or replace".
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ─── profiles: one row per signed-in user (customer / admin / staff) ────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '',
  phone        text,
  email        text,
  address      text default '',
  points       integer not null default 0,   -- WRITTEN BY SERVER ONLY
  is_member    boolean not null default false, -- WRITTEN BY SERVER/ADMIN ONLY
  member_since timestamptz,
  role         text not null default 'customer', -- 'customer'|'admin'|'staff'
  created_at   timestamptz not null default now()
);

-- ─── categories ─────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id    text primary key,
  name  text not null,
  icon  text default '🏷️',
  color text default '#e7f7e9',
  sort  integer default 0
);

-- ─── products ───────────────────────────────────────────────────────────────
create table if not exists public.products (
  id        text primary key,
  name      text not null,
  unit      text default '',
  price     numeric(10,2) not null check (price >= 0),  -- THE REAL PRICE
  mrp       numeric(10,2),
  icon      text default '',
  image_url text,
  category  text references public.categories(id),
  stock     integer,
  active    boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── coupons ────────────────────────────────────────────────────────────────
create table if not exists public.coupons (
  code      text primary key,
  type      text not null check (type in ('percent','flat')),
  value     numeric(10,2) not null check (value > 0),
  min_order numeric(10,2) not null default 0,
  category  text default '',        -- '' = whole cart; else a category id
  active    boolean not null default true
);

-- ─── settings: exactly one row (id = 1) ─────────────────────────────────────
create table if not exists public.settings (
  id                  smallint primary key default 1 check (id = 1),
  store_open          boolean not null default true,
  delivery_mode       text not null default 'normal', -- 'normal'|'surge'
  offer_banner        text default '',
  rewards             jsonb not null default '{"earnPoints":50,"earnPer":399,"redeemPer":10}',
  delivery_fee        numeric(10,2) not null default 25,
  free_delivery_above numeric(10,2) not null default 199,
  handling_fee        numeric(10,2) not null default 5,
  max_distance_km     numeric(6,2) not null default 5,
  shop_locations      jsonb not null default '[]',
  low_stock_threshold integer not null default 5
);

-- ─── orders ─────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  human_code     text unique,               -- e.g. NGS1043
  user_id        uuid references public.profiles(id),
  customer_name  text,
  user_phone     text,
  status         text not null default 'Placed',
  accepted       boolean,                    -- null=pending, true=accepted, false=rejected
  member         boolean not null default false,
  item_total     numeric(10,2) not null,
  discount       numeric(10,2) not null default 0,
  coupon_code    text,
  delivery_fee   numeric(10,2) not null default 0,
  handling       numeric(10,2) not null default 0,
  points_earned  integer not null default 0,
  total          numeric(10,2) not null,
  payment_method text default 'upi',
  payment_status text not null default 'pending', -- pending|paid|failed (server-confirmed)
  distance_km    numeric(6,2),
  location       jsonb,                      -- {lat,lng}
  rating         integer,
  feedback       text,
  created_at     timestamptz not null default now()
);

-- ─── order_items: a price snapshot taken by the SERVER at order time ─────────
create table if not exists public.order_items (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id text,
  name       text,
  icon       text,
  qty        integer not null check (qty > 0),
  price      numeric(10,2) not null           -- server price at time of order
);

-- ─── points_ledger: every points change, append-only ────────────────────────
create table if not exists public.points_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id),
  order_id   uuid references public.orders(id),
  delta      integer not null,                -- +earned / -redeemed
  reason     text,
  created_at timestamptz not null default now()
);

-- ─── notifications: admin → a specific customer ─────────────────────────────
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id),
  title      text not null,
  body       text default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Human-readable order code counter (NGS1043, NGS1044, …)
create sequence if not exists public.order_code_seq start 1043;

-- ─── Helper: is the caller an admin? ────────────────────────────────────────
-- Used inside policies. SECURITY DEFINER so it can read profiles regardless of
-- the caller's own RLS (otherwise policies would recurse). Defined AFTER the
-- profiles table exists because Postgres validates SQL-function bodies at
-- creation time.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.categories      enable row level security;
alter table public.products        enable row level security;
alter table public.coupons         enable row level security;
alter table public.settings        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.points_ledger   enable row level security;
alter table public.notifications   enable row level security;

-- Drop existing policies so this file is re-runnable
do $$ declare r record; begin
  for r in (select policyname, tablename from pg_policies where schemaname='public') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Read your own row; admins read everyone.
create policy "profiles read own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
-- A new signed-in user may create only their own profile row.
create policy "profiles insert self" on public.profiles
  for insert with check (id = auth.uid());
-- You may update your own profile, but a trigger (below) blocks changes to
-- points / role / is_member unless you are admin.
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

-- ── catalog & settings: EVERYONE reads, ONLY admin writes ───────────────────
create policy "categories read all" on public.categories for select using (true);
create policy "categories admin write" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

create policy "products read all" on public.products for select using (true);
create policy "products admin write" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- Customers only see ACTIVE coupons; admins see all. No customer writes.
create policy "coupons read active" on public.coupons
  for select using (active or public.is_admin());
create policy "coupons admin write" on public.coupons
  for all using (public.is_admin()) with check (public.is_admin());

create policy "settings read all" on public.settings for select using (true);
create policy "settings admin write" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── orders: read your own; admins read all; NO direct client insert ─────────
-- (Inserts happen only inside place_order(), which runs as the table owner and
--  therefore bypasses these policies. There is deliberately no INSERT policy.)
create policy "orders read own" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());
-- Customer may update ONLY rating/feedback on their own order; admin may update
-- anything (status, accepted, payment_status…). Column-level safety for the
-- customer path is handled by the rate_order() function; this policy keeps the
-- broad admin path open and lets a customer touch only their own row.
create policy "orders admin update" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

-- ── order_items: read items of orders you can see ───────────────────────────
create policy "order_items read own" on public.order_items
  for select using (
    exists (select 1 from public.orders o
            where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
  );

-- ── points_ledger: read your own; admins read all; NO client write ──────────
create policy "points read own" on public.points_ledger
  for select using (user_id = auth.uid() or public.is_admin());

-- ── notifications: read your own; admin may create/read ─────────────────────
create policy "notifications read own" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());
create policy "notifications own update" on public.notifications
  for update using (user_id = auth.uid());  -- mark as read
create policy "notifications admin write" on public.notifications
  for insert with check (public.is_admin());

-- ============================================================================
-- TRIGGER: stop a customer from raising their own points / role / membership
-- ============================================================================
-- NOT security definer on purpose: we want current_user to reflect the REAL
-- caller. App requests come in as the 'authenticated' / 'anon' roles; the
-- Supabase SQL editor, the service_role key, and our own SECURITY DEFINER
-- functions (which run as the owner, 'postgres') are trusted backend contexts.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Trusted backend contexts (not an app end-user) may change anything. This
  -- covers the Table Editor making you admin, the service key, and the
  -- server-side place_order / redeem_points functions.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- App-admins acting through the API may also change anything.
  if public.is_admin() then
    return new;
  end if;
  -- Every other caller: the protected columns cannot change.
  new.points       := old.points;
  new.is_member    := old.is_member;
  new.member_since := old.member_since;
  new.role         := old.role;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ============================================================================
-- FUNCTION: place_order()  — THE trust boundary
-- ============================================================================
-- The phone sends ONLY: the items (product id + qty), an optional coupon code,
-- an optional {lat,lng}. Everything that touches money is computed here from
-- the database. A tampered phone cannot change a price, a total, or the points.
--
-- p_items example: '[{"id":"p9","qty":2},{"id":"p10","qty":1}]'
create or replace function public.place_order(
  p_items    jsonb,
  p_coupon   text default null,
  p_location jsonb default null,
  p_payment  text default 'upi'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles;
  v_settings   public.settings;
  v_line       jsonb;
  v_prod       public.products;
  v_qty        integer;
  v_item_total numeric := 0;
  v_cat_totals jsonb := '{}';
  v_discount   numeric := 0;
  v_coupon     public.coupons;
  v_eligible   numeric;
  v_delivery   numeric := 0;
  v_handling   numeric := 0;
  v_total      numeric;
  v_points     integer := 0;
  v_rewards    jsonb;
  v_order      public.orders;
  v_code       text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    raise exception 'Profile not found.';
  end if;

  select * into v_settings from public.settings where id = 1;
  if not v_settings.store_open then
    raise exception 'The store is currently closed.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  -- 1) Price every line FROM THE DATABASE, check stock, build category totals.
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then
      raise exception 'Bad quantity in cart.';
    end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then
      raise exception 'A product in your cart is no longer available.';
    end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;
    v_item_total := v_item_total + v_prod.price * v_qty;
    v_cat_totals := jsonb_set(
      v_cat_totals,
      array[coalesce(v_prod.category,'_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category,'_'))::numeric, 0) + v_prod.price * v_qty)
    );
  end loop;

  -- 2) Validate the coupon (server-side) and compute the discount.
  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    select * into v_coupon from public.coupons
      where code = upper(trim(p_coupon)) and active;
    if v_coupon.code is not null then
      if v_coupon.category is not null and v_coupon.category <> '' then
        v_eligible := coalesce((v_cat_totals->>v_coupon.category)::numeric, 0);
      else
        v_eligible := v_item_total;
      end if;
      if v_eligible >= v_coupon.min_order and v_eligible > 0 then
        if v_coupon.type = 'percent' then
          v_discount := floor(v_eligible * v_coupon.value / 100);
        else
          v_discount := v_coupon.value;
        end if;
        v_discount := least(v_discount, v_item_total);
      else
        v_coupon.code := null;  -- didn't qualify → no coupon recorded
      end if;
    end if;
  end if;

  -- 3) Delivery + handling from settings (members deliver free on a normal day).
  v_handling := v_settings.handling_fee;
  if v_item_total >= v_settings.free_delivery_above then
    v_delivery := 0;
  elsif v_settings.delivery_mode = 'normal' and v_profile.is_member then
    v_delivery := 0;
  else
    v_delivery := v_settings.delivery_fee;
  end if;

  -- 4) Total and reward points, both from server values.
  v_total := v_item_total - v_discount + v_delivery + v_handling;
  v_rewards := v_settings.rewards;
  if coalesce((v_rewards->>'earnPer')::numeric, 0) > 0 then
    v_points := floor((v_item_total - v_discount) / (v_rewards->>'earnPer')::numeric)
                * coalesce((v_rewards->>'earnPoints')::int, 0);
  end if;

  -- 5) Insert the order + items atomically; snapshot server prices.
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, coupon_code, delivery_fee, handling, points_earned,
    total, payment_method, payment_status, distance_km, location
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, 'Placed', null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_points,
    v_total, p_payment, 'pending',
    case when p_location is null then null
         else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      values (v_order.id, v_prod.id, v_prod.name, v_prod.icon, v_qty, v_prod.price);
    if v_prod.stock is not null then
      update public.products set stock = greatest(0, stock - v_qty) where id = v_prod.id;
    end if;
  end loop;

  -- 6) Award points via the ledger + profile balance (server-only path).
  if v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    -- Runs as the function owner (postgres), so the profile guard trusts it.
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  return v_order;
end;
$$;

-- Customers may execute place_order, but only through this vetted function.
grant execute on function public.place_order(jsonb, text, jsonb, text) to authenticated;

-- ============================================================================
-- FUNCTION: rate_order() — customer rates only their own delivered order
-- ============================================================================
create or replace function public.rate_order(
  p_order uuid, p_rating int, p_feedback text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1–5.';
  end if;
  update public.orders
    set rating = p_rating, feedback = left(coalesce(p_feedback,''), 500)
    where id = p_order and user_id = auth.uid();
  if not found then
    raise exception 'Order not found.';
  end if;
end;
$$;
grant execute on function public.rate_order(uuid, int, text) to authenticated;

-- ============================================================================
-- FUNCTION: redeem_points() — spend points, server-checked balance
-- ============================================================================
create or replace function public.redeem_points(p_points int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_bal int;
begin
  if p_points <= 0 then raise exception 'Nothing to redeem.'; end if;
  select points into v_bal from public.profiles where id = auth.uid();
  if v_bal < p_points then
    raise exception 'Not enough points.';
  end if;
  insert into public.points_ledger (user_id, delta, reason)
    values (auth.uid(), -p_points, 'Redeemed');
  -- Runs as the function owner (postgres), so the profile guard trusts it.
  update public.profiles set points = points - p_points where id = auth.uid();
  return v_bal - p_points;
end;
$$;
grant execute on function public.redeem_points(int) to authenticated;

-- ============================================================================
-- AUTH HOOK: auto-create a profile row when a user signs up
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'name', ''),
      new.phone,
      new.email
    )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Make sure the single settings row exists.
-- ============================================================================
insert into public.settings (id) values (1) on conflict (id) do nothing;
