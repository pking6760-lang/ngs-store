-- Employee ID for staff: assigned (EMP-001, EMP-002, …) when a partner is
-- approved, shown next to their name on orders and in the apps.
alter table public.partners add column if not exists emp_code text unique;
create sequence if not exists public.partner_emp_seq;

create or replace function public.set_partner_status(p_user uuid, p_status text)
  returns void language plpgsql security definer set search_path = public as $$
declare v_accepted timestamptz; v_code text;
begin
  if not public.is_admin() then raise exception 'Only an admin can review partners.'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Bad status.'; end if;
  if p_status = 'approved' then
    select terms_accepted_at, emp_code into v_accepted, v_code from public.partners where user_id = p_user;
    if v_accepted is null then
      raise exception 'This partner has not accepted the Terms & Conditions yet, so they cannot be approved.';
    end if;
    if v_code is null then
      update public.partners set emp_code = 'EMP-' || lpad(nextval('public.partner_emp_seq')::text, 3, '0')
        where user_id = p_user;
    end if;
  end if;
  update public.partners set status = p_status where user_id = p_user;
  update public.profiles
    set role = case when p_status = 'approved' then 'staff' else 'customer' end
    where id = p_user and role <> 'admin';
end; $$;

-- Backfill already-approved partners.
do $$
declare r record;
begin
  for r in select user_id from public.partners where status = 'approved' and emp_code is null order by created_at loop
    update public.partners set emp_code = 'EMP-' || lpad(nextval('public.partner_emp_seq')::text, 3, '0')
      where user_id = r.user_id;
  end loop;
end $$;
