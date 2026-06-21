-- =============================================================================
-- Immortal Pocket — Step 2: User-data tables
-- Tables: favorites, watch_history, read_history
--
-- These hold per-user data tied to a logged-in account. Each row belongs to
-- exactly one user, and RLS makes sure users only ever touch their own rows.
--
-- How to run: Supabase -> SQL Editor -> New query -> paste -> Run. Re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FAVORITES  — a user bookmarks a series.
--    last_seen_count = how many episodes/chapters existed the last time the
--    user opened it. If the series now has more, that's the "+N NEW" badge.
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  series_id       uuid not null references public.series (id)   on delete cascade,
  last_seen_count integer not null default 0,
  created_at      timestamptz not null default now(),
  -- a user can only favorite a given series once
  unique (user_id, series_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id);


-- -----------------------------------------------------------------------------
-- 2. WATCH HISTORY  — resume position for anime episodes ("Continue Watching").
--    series_id is denormalized so we can show one card per series easily.
-- -----------------------------------------------------------------------------
create table if not exists public.watch_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id)  on delete cascade,
  series_id     uuid not null references public.series (id)    on delete cascade,
  episode_id    uuid not null references public.episodes (id)  on delete cascade,
  position_secs integer not null default 0,    -- where they paused
  duration_secs integer,                       -- total length (for the % bar)
  progress_pct  integer not null default 0
                  check (progress_pct between 0 and 100),
  completed     boolean not null default false,
  updated_at    timestamptz not null default now(),
  -- one progress row per (user, episode); re-watching just updates it
  unique (user_id, episode_id)
);

-- "Continue Watching" = a user's rows, most recent first.
create index if not exists watch_history_user_idx
  on public.watch_history (user_id, updated_at desc);


-- -----------------------------------------------------------------------------
-- 3. READ HISTORY  — resume position for manhwa chapters ("Continue Reading").
-- -----------------------------------------------------------------------------
create table if not exists public.read_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id)  on delete cascade,
  series_id    uuid not null references public.series (id)    on delete cascade,
  chapter_id   uuid not null references public.chapters (id)  on delete cascade,
  last_page    integer not null default 0,     -- index of the last page read
  page_count   integer,                        -- total pages (for the % bar)
  progress_pct integer not null default 0
                 check (progress_pct between 0 and 100),
  completed    boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (user_id, chapter_id)
);

create index if not exists read_history_user_idx
  on public.read_history (user_id, updated_at desc);


-- -----------------------------------------------------------------------------
-- Keep updated_at fresh on the two history tables (favorites only has created_at).
-- Reuses public.set_updated_at() from Step 1.
-- -----------------------------------------------------------------------------
drop trigger if exists watch_history_set_updated_at on public.watch_history;
create trigger watch_history_set_updated_at
  before update on public.watch_history
  for each row execute function public.set_updated_at();

drop trigger if exists read_history_set_updated_at on public.read_history;
create trigger read_history_set_updated_at
  before update on public.read_history
  for each row execute function public.set_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY — each user sees and changes ONLY their own rows.
-- One simple rule per table: the row's user_id must equal the caller's id.
-- =============================================================================
alter table public.favorites     enable row level security;
alter table public.watch_history enable row level security;
alter table public.read_history  enable row level security;

drop policy if exists "favorites own rows" on public.favorites;
create policy "favorites own rows" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "watch_history own rows" on public.watch_history;
create policy "watch_history own rows" on public.watch_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read_history own rows" on public.read_history;
create policy "read_history own rows" on public.read_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
