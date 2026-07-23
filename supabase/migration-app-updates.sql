-- In-app forced-update registry. The admin publishes the latest version + APK
-- link for an app; any installed app whose versionCode is lower shows a
-- non-dismissible "Update required" screen until the new APK is installed.
create table if not exists public.app_versions (
  app           text primary key,          -- 'customer' | 'partner' | 'admin'
  version_name  text not null,             -- e.g. '1.1'
  version_code  int  not null,             -- must match the APK's versionCode
  apk_url       text,                       -- public download link
  release_notes text,
  updated_at    timestamptz not null default now()
);
alter table public.app_versions enable row level security;
-- Everyone can read the latest version (the apps check it, even signed-out).
drop policy if exists app_versions_read on public.app_versions;
create policy app_versions_read on public.app_versions for select using (true);

-- Seed current versions so nothing is blocked until a real update is published.
insert into public.app_versions (app, version_name, version_code) values
  ('customer', '1.0', 1), ('partner', '1.0', 1)
on conflict (app) do nothing;

-- Public read helper (callable signed-out too).
create or replace function public.get_app_version(p_app text)
returns table(app text, version_name text, version_code int, apk_url text, release_notes text)
language sql stable security definer set search_path to 'public' as $$
  select app, version_name, version_code, apk_url, release_notes
    from public.app_versions where app = p_app;
$$;
revoke all on function public.get_app_version(text) from public;
grant execute on function public.get_app_version(text) to anon, authenticated;

-- Admin publishes a new version (bumps everyone below it into the update wall).
create or replace function public.admin_publish_app_version(
  p_app text, p_version_name text, p_version_code int, p_apk_url text, p_notes text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_app not in ('customer','partner','admin') then raise exception 'Unknown app.'; end if;
  if coalesce(p_version_code,0) <= 0 then raise exception 'Version code must be positive.'; end if;
  insert into public.app_versions (app, version_name, version_code, apk_url, release_notes, updated_at)
  values (p_app, p_version_name, p_version_code, nullif(trim(p_apk_url),''), nullif(trim(p_notes),''), now())
  on conflict (app) do update set
    version_name = excluded.version_name, version_code = excluded.version_code,
    apk_url = excluded.apk_url, release_notes = excluded.release_notes, updated_at = now();
end; $$;
revoke all on function public.admin_publish_app_version(text,text,int,text,text) from public;
revoke all on function public.admin_publish_app_version(text,text,int,text,text) from anon;
grant execute on function public.admin_publish_app_version(text,text,int,text,text) to authenticated;
