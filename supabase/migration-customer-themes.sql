-- ════════════════════════════════════════════════════════════════════════════
-- Festival themes for the customer app (web + APK).
--
-- Admin pastes a theme JSON (generated from the "Copy AI prompt" flow, exactly
-- like Auto-notifications) into the Themes screen. The customer app fetches the
-- currently-active theme via get_active_theme() and repaints itself — colours,
-- a festive greeting ribbon and falling decorations — for Independence Day,
-- Dussehra, Diwali, Dhanteras, and so on.
--
-- A theme can be scheduled (starts_on / ends_on) so it switches on by itself on
-- the day, or left open (no dates) and flipped on/off by hand.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_themes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text default '',
  starts_on  date,                 -- optional schedule window (inclusive)
  ends_on    date,
  theme      jsonb not null default '{}'::jsonb,   -- colours, banner, greeting, decoration
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.customer_themes enable row level security;

-- Admin has full control (same gate as notification_templates).
drop policy if exists themes_admin on public.customer_themes;
create policy themes_admin on public.customer_themes
  for all using (is_admin()) with check (is_admin());

-- Anyone (incl. logged-out browsers) may read active themes so the app can paint.
drop policy if exists themes_read_active on public.customer_themes;
create policy themes_read_active on public.customer_themes
  for select using (active = true);

-- The one theme the customer app should show right now: active, inside its date
-- window (or undated), preferring a dated/targeted theme, newest first.
create or replace function public.get_active_theme()
 returns jsonb
 language sql stable security definer set search_path to 'public' as $$
  select coalesce(theme, '{}'::jsonb) || jsonb_build_object(
           'id', id, 'name', name, 'emoji', emoji,
           'startsOn', starts_on, 'endsOn', ends_on
         )
    from public.customer_themes
   where active
     and (starts_on is null or current_date >= starts_on)
     and (ends_on   is null or current_date <= ends_on)
   order by (starts_on is not null) desc, created_at desc
   limit 1;
$$;
grant execute on function public.get_active_theme() to anon, authenticated;

-- Bulk import from the pasted JSON. Accepts a single theme object or an array
-- of them; each object carries name/emoji/startsOn/endsOn plus the visual keys.
create or replace function public.import_customer_themes(p_items jsonb)
 returns integer
 language plpgsql security definer set search_path to 'public' as $$
declare v_arr jsonb; v_it jsonb; v_n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  v_arr := case when jsonb_typeof(p_items) = 'array' then p_items else jsonb_build_array(p_items) end;
  for v_it in select * from jsonb_array_elements(v_arr) loop
    insert into public.customer_themes (name, emoji, starts_on, ends_on, theme)
    values (
      coalesce(nullif(v_it->>'name',''), 'Festival theme'),
      coalesce(v_it->>'emoji',''),
      nullif(v_it->>'startsOn','')::date,
      nullif(v_it->>'endsOn','')::date,
      (v_it - 'name' - 'emoji' - 'startsOn' - 'endsOn')
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
grant execute on function public.import_customer_themes(jsonb) to authenticated;

select 'customer themes ready' as status;
