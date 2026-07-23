-- Expose the store contact number to the partner app so a rider can tap
-- "Call store" during a delivery / milk round. Reads settings.support_phone
-- (the same number the customer's "Call store" uses), digits only.
create or replace function public.get_partner_config()
 returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'storeOpenHour',  o.store_open_hour,
    'storeCloseHour', o.store_close_hour,
    'riderCashCap',   o.rider_cash_cap,
    'pickerSlotMin',  o.picker_slot_min,
    'storePhone',     (select regexp_replace(coalesce(support_phone,''), '\D', '', 'g') from public.settings where id = 1)
  ) from public.ops_config o where o.id = 1;
$$;
select 'partner config exposes storePhone' as status;
