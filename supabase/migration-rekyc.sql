-- General re-KYC requests: a list of items the partner must (re)submit.
alter table public.partners add column if not exists kyc_requests text[] not null default '{}';

-- Admin asks a partner to (re)submit one or more KYC items.
-- Item keys: selfie | aadhaar_front | aadhaar_back | pan | dl
create or replace function public.admin_request_kyc(p_user_id uuid, p_items text[])
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.partners set kyc_requests = coalesce(p_items, '{}') where user_id = p_user_id;
end $function$;
grant execute on function public.admin_request_kyc(uuid, text[]) to authenticated;

-- Partner submits ONE requested item — updates just that field and removes it
-- from the outstanding request list. p_extra carries the liveness video for a
-- selfie. Everything else in their approved KYC is untouched.
create or replace function public.partner_submit_kyc_item(p_item text, p_path text, p_extra text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.partners set
    selfie_path         = case when p_item = 'selfie' then p_path else selfie_path end,
    liveness_video_path = case when p_item = 'selfie' then coalesce(p_extra, liveness_video_path) else liveness_video_path end,
    aadhaar_front       = case when p_item = 'aadhaar_front' then p_path else aadhaar_front end,
    aadhaar_back        = case when p_item = 'aadhaar_back' then p_path else aadhaar_back end,
    pan                 = case when p_item = 'pan' then p_path else pan end,
    dl                  = case when p_item = 'dl' then p_path else dl end,
    kyc_requests        = array_remove(kyc_requests, p_item)
  where user_id = auth.uid();
end $function$;
grant execute on function public.partner_submit_kyc_item(text, text, text) to authenticated;
