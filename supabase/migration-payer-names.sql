-- migration-payer-names.sql
-- The "name book" for Store QR payments.
--
-- Razorpay does not provide the payer's name for UPI QR payments (only the VPA),
-- so we keep our own name book: name a customer once against their UPI ID and
-- every past and future payment from that VPA shows the name (and the soundbox
-- announces it). Accessed only through the store-qr edge function (service role),
-- so RLS is on with no client policies.

create table if not exists public.payer_names (
  vpa        text primary key,          -- the payer's UPI ID (e.g. name@okhdfcbank)
  name       text not null,             -- the name the shop assigned
  created_by uuid,                      -- admin who named them
  updated_at timestamptz not null default now()
);

alter table public.payer_names enable row level security;
