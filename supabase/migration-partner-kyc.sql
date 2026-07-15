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

-- Hard rule: a partner cannot be APPROVED unless they have accepted the Terms.
-- Enforced in the database so it can't be bypassed from any client.
create or replace function public.set_partner_status(p_user uuid, p_status text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_accepted timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can review partners.';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Bad status.';
  end if;
  if p_status = 'approved' then
    select terms_accepted_at into v_accepted from public.partners where user_id = p_user;
    if v_accepted is null then
      raise exception 'This partner has not accepted the Terms & Conditions yet, so they cannot be approved.';
    end if;
  end if;
  update public.partners set status = p_status where user_id = p_user;
  update public.profiles
    set role = case when p_status = 'approved' then 'staff' else 'customer' end
    where id = p_user and role <> 'admin';
end;
$function$;
