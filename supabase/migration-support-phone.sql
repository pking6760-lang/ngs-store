-- Store contact number shown as a "Call store" button on the customer's live
-- order screen. Set by the owner in Admin → Delivery → Store contact number.
alter table public.settings add column if not exists support_phone text;
select 'support_phone ready' as status;
