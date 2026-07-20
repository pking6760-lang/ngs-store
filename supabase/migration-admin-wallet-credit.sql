-- ════════════════════════════════════════════════════════════════════════════
-- Admin: give (or deduct) a CUSTOMER's wallet money.
--   The existing admin_wallet_adjust writes to the PARTNER ledger — wrong table
--   for customers. This credits public.customer_wallet directly. Admin-only.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_customer_wallet_credit(p_user uuid, p_amount numeric, p_note text default null)
 returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare v_bal numeric;
begin
  if not public.is_admin() then raise exception 'Only the shop can add wallet money.'; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Enter a non-zero amount.'; end if;
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (p_user, p_amount,
            case when p_amount > 0 then 'topup' else 'spent' end,
            coalesce(nullif(trim(p_note), ''), case when p_amount > 0 then 'Added by shop' else 'Deducted by shop' end),
            auth.uid());
  select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = p_user;
  return v_bal;
end; $function$;
revoke execute on function public.admin_customer_wallet_credit(uuid, numeric, text) from public, anon;
grant execute on function public.admin_customer_wallet_credit(uuid, numeric, text) to authenticated;
