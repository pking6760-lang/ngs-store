-- M5 · Partners (role 'staff') could read all shop economics from ops_config
-- (margins, payout formulas, penalties). Restrict the table to admins and give
-- partners a SECURITY DEFINER RPC that returns ONLY the fields their app needs.
create or replace function public.get_partner_config()
 returns jsonb language sql security definer set search_path to 'public' stable as $$
  select jsonb_build_object(
    'storeOpenHour',  store_open_hour,
    'storeCloseHour', store_close_hour,
    'riderCashCap',   rider_cash_cap,
    'pickerSlotMin',  picker_slot_min
  ) from public.ops_config where id = 1;
$$;
revoke execute on function public.get_partner_config() from public, anon;
grant execute on function public.get_partner_config() to authenticated;

-- Lock the raw table to admins only (partners now use the RPC; no customer reads it).
drop policy if exists ops_read on public.ops_config;
create policy ops_read on public.ops_config for select using (public.is_admin());
