-- NGS Partner: store the bank + branch resolved from the IFSC code so the
-- owner sees a real bank/branch (not just a code) when reviewing a partner.
alter table public.partners
  add column if not exists bank_name text,
  add column if not exists bank_branch text;
