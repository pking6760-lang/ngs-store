-- Let an existing partner re-accept an updated Terms version (records consent
-- to the new penalty / wallet-deduction clauses). Updates only the caller's own
-- partner row.
create or replace function public.partner_accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.partners
     set terms_accepted_at = now(), terms_version = p_version
   where user_id = auth.uid();
  if not found then
    raise exception 'No partner profile for this account.';
  end if;
end;
$function$;

revoke execute on function public.partner_accept_terms(text) from public, anon;
grant execute on function public.partner_accept_terms(text) to authenticated;
