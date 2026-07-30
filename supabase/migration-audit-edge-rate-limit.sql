-- AUDIT FIX (Medium #7 part): a lightweight per-key rate limiter for edge
-- functions that call PAID third-party APIs with only the public anon key
-- (places-search → Ola/Google Maps). When the limit is exceeded the caller
-- degrades to the free OpenStreetMap fallback instead of spending the owner's
-- Maps quota. Server-only.
create schema if not exists private;
create table if not exists private.edge_rate (
  bucket       text primary key,
  n            int not null default 0,
  window_start timestamptz not null default now()
);

create or replace function public.edge_rate_ok(p_bucket text, p_max int, p_window_secs int)
returns boolean
language plpgsql security definer set search_path to public, private
as $$
declare v_n int;
begin
  insert into private.edge_rate as e (bucket, n, window_start) values (p_bucket, 1, now())
  on conflict (bucket) do update set
    n = case when e.window_start < now() - make_interval(secs => p_window_secs) then 1 else e.n + 1 end,
    window_start = case when e.window_start < now() - make_interval(secs => p_window_secs) then now() else e.window_start end
  returning n into v_n;
  return v_n <= p_max;
end; $$;
revoke all on function public.edge_rate_ok(text, int, int) from public, anon, authenticated;
