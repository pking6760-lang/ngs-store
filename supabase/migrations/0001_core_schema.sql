-- =============================================================================
-- Immortal Pocket — Step 1: Core database schema
-- Tables: series, episodes, chapters, profiles (users)
--
-- How to run: open your Supabase project -> SQL Editor -> New query ->
-- paste this whole file -> Run. It is safe to re-run (idempotent).
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto; Supabase has it, this just makes sure.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared helper: keep an updated_at column current on every UPDATE.
-- We attach this trigger to each table below instead of repeating logic.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- 1. SERIES  — one row per title. `kind` decides anime (video) vs manhwa (comic)
-- =============================================================================
create table if not exists public.series (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('anime', 'manhwa')),
  title       text not null,
  -- slug = clean URL piece, e.g. /series/nine-realms-of-ascending-cloud
  slug        text unique,
  synopsis    text,
  cover_url   text,                          -- poster image (Bunny Storage URL)
  genres      text[] not null default '{}',  -- e.g. {Cultivation, Action}
  status      text not null default 'ongoing'
                check (status in ('ongoing', 'completed', 'hiatus')),
  published   boolean not null default true, -- false = hidden from the site
  views       bigint not null default 0,     -- engagement -> drives "Trending"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes for the home page queries: filter by kind, sort by views/recency.
create index if not exists series_kind_idx       on public.series (kind);
create index if not exists series_views_idx      on public.series (views desc);
create index if not exists series_created_at_idx on public.series (created_at desc);

drop trigger if exists series_set_updated_at on public.series;
create trigger series_set_updated_at
  before update on public.series
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. EPISODES  — anime video episodes. One Bunny Stream video each.
-- =============================================================================
create table if not exists public.episodes (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  number          numeric not null,          -- numeric allows specials like 12.5
  title           text,                      -- optional ("The First Breath")
  thumbnail_url   text,                      -- optional still (Bunny Storage)
  bunny_video_id  text,                      -- GUID from Bunny Stream
  duration_secs   integer,                   -- optional runtime
  published       boolean not null default true,
  views           bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- you can't have two "Episode 5" in the same series
  unique (series_id, number)
);

create index if not exists episodes_series_idx on public.episodes (series_id, number);

drop trigger if exists episodes_set_updated_at on public.episodes;
create trigger episodes_set_updated_at
  before update on public.episodes
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. CHAPTERS  — manhwa chapters. Ordered page images live in page_urls.
-- =============================================================================
create table if not exists public.chapters (
  id            uuid primary key default gen_random_uuid(),
  series_id     uuid not null references public.series (id) on delete cascade,
  number        numeric not null,
  title         text,
  thumbnail_url text,
  page_urls     text[] not null default '{}', -- ordered list of page images
  published     boolean not null default true,
  views         bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (series_id, number)
);

create index if not exists chapters_series_idx on public.chapters (series_id, number);

drop trigger if exists chapters_set_updated_at on public.chapters;
create trigger chapters_set_updated_at
  before update on public.chapters
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 4. PROFILES (users)  — public app data for each logged-in account.
--    Links 1-to-1 to Supabase's private auth.users table.
-- =============================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  avatar_url    text,
  role          text not null default 'user' check (role in ('user', 'admin')),
  is_premium    boolean not null default false,
  premium_plan  text check (premium_plan in ('week', 'month', 'year')),
  premium_until timestamptz,                 -- when the subscription expires
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever someone signs up (Google or email).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- ROW LEVEL SECURITY
-- Supabase exposes every table over a public API, so RLS is the lock on the
-- door. Rule of thumb here: the world can READ published content; only admins
-- can WRITE content; users can only see/edit their OWN profile.
-- =============================================================================
alter table public.series   enable row level security;
alter table public.episodes enable row level security;
alter table public.chapters enable row level security;
alter table public.profiles enable row level security;

-- Helper: is the current request coming from an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---- series ----------------------------------------------------------------
drop policy if exists "series public read"  on public.series;
create policy "series public read" on public.series
  for select using (published or public.is_admin());

drop policy if exists "series admin write" on public.series;
create policy "series admin write" on public.series
  for all using (public.is_admin()) with check (public.is_admin());

-- ---- episodes --------------------------------------------------------------
drop policy if exists "episodes public read"  on public.episodes;
create policy "episodes public read" on public.episodes
  for select using (published or public.is_admin());

drop policy if exists "episodes admin write" on public.episodes;
create policy "episodes admin write" on public.episodes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---- chapters --------------------------------------------------------------
drop policy if exists "chapters public read"  on public.chapters;
create policy "chapters public read" on public.chapters
  for select using (published or public.is_admin());

drop policy if exists "chapters admin write" on public.chapters;
create policy "chapters admin write" on public.chapters
  for all using (public.is_admin()) with check (public.is_admin());

-- ---- profiles --------------------------------------------------------------
-- A user can read and update only their own row. Admins can read everyone.
drop policy if exists "profile read own"   on public.profiles;
create policy "profile read own" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Note: we do NOT allow users to change their own role or premium status from
-- the client. Those get set server-side (admin action / payment webhook) using
-- the service-role key, which bypasses RLS. We'll wire that up in a later step.
