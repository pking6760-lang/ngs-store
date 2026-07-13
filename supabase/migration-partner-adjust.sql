-- Admin corrections for mistakes/test data: clear a partner's strikes, and post
-- a manual wallet adjustment (e.g. to reverse a wrong payout). Both admin-only.
create or replace function public.admin_clear_strikes(p_user uuid)
  returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Only the shop can clear strikes.'; end if;
  delete from public.partner_strikes where partner_id = p_user;
  get diagnostics n = row_count;
  return n;
end; $$;

create or replace function public.admin_wallet_adjust(p_user uuid, p_amount numeric, p_note text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the shop can adjust a wallet.'; end if;
  if p_amount = 0 then raise exception 'Enter a non-zero amount.'; end if;
  insert into public.wallet_ledger (partner_id, kind, amount, note, created_by)
  values (p_user, 'adjustment', p_amount, coalesce(nullif(trim(p_note), ''), 'Manual adjustment'), auth.uid());
end; $$;

grant execute on function public.admin_clear_strikes(uuid) to authenticated;
grant execute on function public.admin_wallet_adjust(uuid, numeric, text) to authenticated;
