-- NGS Partner: store the document numbers the partner types in (validated on
-- the client — Aadhaar Verhoeff checksum, PAN & DL format) so the owner sees a
-- verification report card before approving.
alter table public.partners
  add column if not exists aadhaar_number text,
  add column if not exists pan_number text,
  add column if not exists dl_number text;

-- Record the partner's acceptance of the Terms & Conditions / declaration of
-- authenticity (timestamp + version) so there is a legal record of consent.
alter table public.partners
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
