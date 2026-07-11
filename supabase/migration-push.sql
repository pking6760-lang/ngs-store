-- ============================================================================
-- MIGRATION: admin push-notification device tokens
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Stores the FCM device token(s) of signed-in admins so the server can push a
-- "new order" notification to their phone(s).
-- ============================================================================

create table if not exists public.admin_push_tokens (
  token      text primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.admin_push_tokens enable row level security;

drop policy if exists "admin tokens read" on public.admin_push_tokens;
drop policy if exists "admin tokens write" on public.admin_push_tokens;

-- Only admins can register/read tokens. The server (service role) bypasses RLS
-- to read every token when sending a push.
create policy "admin tokens read" on public.admin_push_tokens
  for select using (public.is_admin());
create policy "admin tokens write" on public.admin_push_tokens
  for all using (public.is_admin()) with check (public.is_admin());

-- Save (or refresh) the calling admin's device token.
create or replace function public.save_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can register for order alerts.';
  end if;
  insert into public.admin_push_tokens (token, user_id, updated_at)
    values (p_token, auth.uid(), now())
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
end;
$$;
grant execute on function public.save_push_token(text) to authenticated;
