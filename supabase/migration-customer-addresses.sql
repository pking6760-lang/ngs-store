-- ============================================================================
-- Customer saved addresses (Home / Work / Other) with a default that drives the
-- delivery address shown in the header and used at checkout (profiles.address).
--
-- RLS: a customer only ever sees/edits their own addresses. All mutations that
-- change the default also sync profiles.address so the rest of the app (header,
-- checkout) keeps working off the single "active" address.
-- ============================================================================

create table if not exists public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text not null default 'home',        -- 'home' | 'work' | 'other'
  full_address text not null,
  location     jsonb,                                -- { lat, lng } (optional)
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id);

alter table public.customer_addresses enable row level security;

drop policy if exists "addr own select" on public.customer_addresses;
drop policy if exists "addr own insert" on public.customer_addresses;
drop policy if exists "addr own update" on public.customer_addresses;
drop policy if exists "addr own delete" on public.customer_addresses;
create policy "addr own select" on public.customer_addresses for select using (user_id = auth.uid());
create policy "addr own insert" on public.customer_addresses for insert with check (user_id = auth.uid());
create policy "addr own update" on public.customer_addresses for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "addr own delete" on public.customer_addresses for delete using (user_id = auth.uid());

-- ── Add an address (first one, or any 'make default' one, becomes active). ──
create or replace function public.add_address(p_label text, p_address text, p_location jsonb default null, p_make_default boolean default true)
 returns public.customer_addresses language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_row public.customer_addresses; v_first boolean; v_label text;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if coalesce(trim(p_address),'') = '' then raise exception 'Please enter an address.'; end if;
  v_label := lower(coalesce(nullif(trim(p_label),''), 'home'));
  if v_label not in ('home','work','other') then v_label := 'other'; end if;
  select count(*) = 0 into v_first from public.customer_addresses where user_id = v_uid;
  insert into public.customer_addresses (user_id, label, full_address, location, is_default)
    values (v_uid, v_label, trim(p_address), p_location, coalesce(p_make_default,true) or v_first)
    returning * into v_row;
  if v_row.is_default then
    update public.customer_addresses set is_default = (id = v_row.id) where user_id = v_uid;
    update public.profiles set address = v_row.full_address where id = v_uid;
  end if;
  return v_row;
end $function$;
grant execute on function public.add_address(text, text, jsonb, boolean) to authenticated;

-- ── Edit an address; if it's the active one, keep profiles.address in sync. ──
create or replace function public.update_address(p_id uuid, p_label text, p_address text, p_location jsonb default null)
 returns public.customer_addresses language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_row public.customer_addresses; v_label text;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if coalesce(trim(p_address),'') = '' then raise exception 'Please enter an address.'; end if;
  v_label := lower(coalesce(nullif(trim(p_label),''), 'home'));
  if v_label not in ('home','work','other') then v_label := 'other'; end if;
  update public.customer_addresses
     set label = v_label, full_address = trim(p_address), location = p_location
   where id = p_id and user_id = v_uid
   returning * into v_row;
  if v_row.id is null then raise exception 'Address not found.'; end if;
  if v_row.is_default then
    update public.profiles set address = v_row.full_address where id = v_uid;
  end if;
  return v_row;
end $function$;
grant execute on function public.update_address(uuid, text, text, jsonb) to authenticated;

-- ── Choose the active delivery address. ──
create or replace function public.set_default_address(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_addr text;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select full_address into v_addr from public.customer_addresses where id = p_id and user_id = v_uid;
  if v_addr is null then raise exception 'Address not found.'; end if;
  update public.customer_addresses set is_default = (id = p_id) where user_id = v_uid;
  update public.profiles set address = v_addr where id = v_uid;
end $function$;
grant execute on function public.set_default_address(uuid) to authenticated;

-- ── Delete an address; if it was the active one, promote the newest remaining. ──
create or replace function public.delete_address(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_was_default boolean; v_new public.customer_addresses;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select is_default into v_was_default from public.customer_addresses where id = p_id and user_id = v_uid;
  if v_was_default is null then return; end if;   -- not theirs / already gone
  delete from public.customer_addresses where id = p_id and user_id = v_uid;
  if v_was_default then
    select * into v_new from public.customer_addresses where user_id = v_uid order by created_at desc limit 1;
    if v_new.id is not null then
      update public.customer_addresses set is_default = (id = v_new.id) where user_id = v_uid;
      update public.profiles set address = v_new.full_address where id = v_uid;
    else
      update public.profiles set address = null where id = v_uid;
    end if;
  end if;
end $function$;
grant execute on function public.delete_address(uuid) to authenticated;
