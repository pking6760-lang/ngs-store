-- ════════════════════════════════════════════════════════════════════════════
-- In-app calling upgrades:
--   • Busy signal — if the person you're calling is already on a call, the
--     caller is told to try again instead of a silent no-answer.
--   • Caller reference — the call carries the caller's searchable ID (a
--     customer's customer_code or a partner's emp_code) + phone + role, so the
--     admin who answers can look them up and resolve the issue.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.calls add column if not exists caller_ref   text;
alter table public.calls add column if not exists caller_phone text;

create or replace function public.call_order_party(p_order uuid)
 returns calls language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); o public.orders; v_callee uuid;
        v_name text; v_role text; v_ref text; v_phone text; v_call public.calls;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;

  if v_uid = o.user_id then
    v_callee := coalesce(o.rider_id, public._shop_owner_id());
    v_role := 'customer';
  elsif v_uid = o.rider_id or v_uid = o.picker_id or public.is_admin() then
    v_callee := o.user_id;
    v_role := case when v_uid = o.rider_id or v_uid = o.picker_id then 'partner' else 'owner' end;
  else
    raise exception 'You are not part of this order.';
  end if;
  if v_callee is null or v_callee = v_uid then raise exception 'No one to call on this order yet.'; end if;

  -- Busy: the callee is already on a live call (ringing or accepted, recently).
  if exists (
    select 1 from public.calls
     where (callee_id = v_callee or caller_id = v_callee)
       and status in ('ringing','accepted')
       and created_at > now() - interval '90 seconds'
  ) then
    raise exception 'NGS_BUSY';
  end if;

  -- Caller's display name + searchable id + phone (shown to whoever answers).
  if v_role = 'customer' then
    select coalesce(name,'Customer'), customer_code, phone
      into v_name, v_ref, v_phone from public.profiles where id = v_uid;
  else
    v_name := coalesce(
      (select full_name from public.partners where user_id = v_uid),
      (select name from public.profiles where id = v_uid), 'NGS');
    v_ref := (select emp_code from public.partners where user_id = v_uid);
    v_phone := (select phone from public.profiles where id = v_uid);
  end if;

  insert into public.calls (caller_id, callee_id, caller_name, caller_role, caller_ref, caller_phone, order_id)
    values (v_uid, v_callee, v_name, v_role, v_ref, v_phone, p_order) returning * into v_call;
  perform public._ring_call(v_call);
  return v_call;
end; $$;

select 'call busy + ref ready' as status;
