-- ============================================================================
-- MIGRATION: NGS Partner onboarding (KYC) + document storage
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- A delivery/picker registers in the NGS Partner app: role, name, address,
-- bank details, and photo documents (Aadhaar front/back, PAN, and — for
-- delivery unless they ride a low-speed EV — a driving licence). They start as
-- 'pending'; the owner reviews the documents in the admin and approves them,
-- which flips their profile to the 'staff' role so they can work.
-- ============================================================================

-- ── Partner registrations ───────────────────────────────────────────────────
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references public.profiles(id) on delete cascade,
  role          text not null check (role in ('picker', 'delivery')),
  full_name     text not null,
  phone         text,
  email         text,
  address       text,
  bank_account  text,
  bank_ifsc     text,
  bank_holder   text,
  uses_ev       boolean not null default false,
  aadhaar_front text,   -- storage object paths in the private 'partner-docs' bucket
  aadhaar_back  text,
  pan           text,
  dl            text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at    timestamptz not null default now()
);

alter table public.partners enable row level security;

drop policy if exists "partners read own or admin" on public.partners;
create policy "partners read own or admin" on public.partners
  for select using (user_id = auth.uid() or public.is_admin());

-- A signed-in person may create/update their OWN registration while it's pending.
drop policy if exists "partners insert self" on public.partners;
create policy "partners insert self" on public.partners
  for insert with check (user_id = auth.uid());

drop policy if exists "partners update own pending or admin" on public.partners;
create policy "partners update own pending or admin" on public.partners
  for update using (public.is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (user_id = auth.uid() and status = 'pending'));

-- Owner approves/rejects a partner. Approving grants the 'staff' role so they
-- can read the order queue and advance statuses; rejecting revokes it.
create or replace function public.set_partner_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can review partners.';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Bad status.';
  end if;
  update public.partners set status = p_status where user_id = p_user;
  update public.profiles
    set role = case when p_status = 'approved' then 'staff' else 'customer' end
    where id = p_user and role <> 'admin';
end;
$$;
grant execute on function public.set_partner_status(uuid, text) to authenticated;

-- ── Private storage bucket for KYC documents ────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('partner-docs', 'partner-docs', false)
  on conflict (id) do nothing;

-- A partner may upload/replace files ONLY in their own folder ({uid}/...).
-- Reads are allowed to the owner and to admins (who review the documents).
drop policy if exists "partner docs write own" on storage.objects;
create policy "partner docs write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner docs update own" on storage.objects;
create policy "partner docs update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner docs read own or admin" on storage.objects;
create policy "partner docs read own or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'partner-docs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
