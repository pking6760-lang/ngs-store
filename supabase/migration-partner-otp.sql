-- ============================================================================
-- MIGRATION: separate "NGS Partner" email OTP
-- Run once. Safe to re-run.
--
-- Partners get their own branded login code (sent via Brevo from the Edge
-- Functions), independent of the customer login. Codes are stored HASHED with a
-- short expiry; the table is service-role only (no client access).
-- ============================================================================

create table if not exists public.partner_otps (
  email       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

-- Locked down: only the service role (the Edge Functions) touches this table.
alter table public.partner_otps enable row level security;
-- (No policies → no anon/authenticated access at all.)
