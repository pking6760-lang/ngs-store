-- migration-store-qr.sql
-- Permanent "Store QR" feature for the admin app.
--
-- The shop gets a standing UPI QR (like a Paytm/PhonePe soundbox sticker):
--   • OPEN QR   — no expiry, no fixed amount. The customer scans, types any
--                 amount, and pays. The soundbox announces it.
--   • FIXED QR  — no expiry, a set amount (e.g. a ₹100 sticker for one item),
--                 reusable, downloadable and shareable.
--
-- Both are created once through Razorpay (usage=multiple_use, no close_by) and
-- saved here so the same QR image is reused forever. Every payment made on a
-- store QR is recorded in the existing counter_collections table (so it flows
-- into the soundbox poll and shows in history) — see razorpay-webhook and the
-- store-qr edge function.

create table if not exists public.store_qrs (
  id          uuid primary key default gen_random_uuid(),
  rzp_qr_id   text unique not null,           -- Razorpay qr_code id (qr_...)
  kind        text not null default 'open'    -- 'open' (any amount) | 'fixed'
                check (kind in ('open','fixed')),
  amount      numeric,                         -- rupees, only for kind='fixed'
  label       text,                            -- optional name shown on the QR
  image_url   text,                            -- Razorpay-hosted PNG
  image_data  text,                            -- inlined base64 PNG (offline-safe)
  created_by  uuid,                            -- admin who made it
  created_at  timestamptz not null default now()
);

-- Only ever one live OPEN QR for the shop.
create unique index if not exists store_qrs_one_open
  on public.store_qrs (kind) where (kind = 'open');

create index if not exists store_qrs_created_at on public.store_qrs (created_at desc);

-- Accessed only through edge functions running with the service role, so lock
-- the table down to the client entirely (service role bypasses RLS).
alter table public.store_qrs enable row level security;

-- A store-QR payment is inserted by the webhook/sync with no per-payment intent
-- row, so counter_collections.created_by must tolerate being absent.
do $$
begin
  alter table public.counter_collections alter column created_by drop not null;
exception when others then null;
end $$;

-- The original single-use "Collect payment" design made qr_id UNIQUE (one
-- payment per QR). The Store QR is multiple-use, so many payments share the same
-- qr_id — drop that unique constraint or every payment after the first is
-- silently rejected with a duplicate-key error (both in the webhook and sync).
alter table public.counter_collections drop constraint if exists counter_collections_qr_id_key;

-- Fast "history for this QR" (non-unique).
create index if not exists counter_collections_qr_id on public.counter_collections (qr_id);

-- One row per real payment: stops the webhook and the sync safety-net from ever
-- recording the same payment twice (pending rows keep payment_id null, and many
-- nulls are allowed by a partial unique index). Guarded so pre-existing data
-- can't abort the migration.
do $$
begin
  create unique index if not exists counter_collections_payment_id_uniq
    on public.counter_collections (payment_id) where (payment_id is not null);
exception when others then
  create index if not exists counter_collections_payment_id
    on public.counter_collections (payment_id);
end $$;
