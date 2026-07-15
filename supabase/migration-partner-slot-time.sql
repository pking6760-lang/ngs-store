-- Fix: a partner can only book a slot that is still in the future. A slot that
-- has already started or passed today (IST) — or any slot on a past date — is
-- rejected. (Supersedes book_slot in migration-partner-ops-fns.sql.)
create or replace function public.book_slot(p_role text, p_date date, p_hour int)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_cnt int; v_status text; v_role text; v_now_date date; v_now_hour int;
begin
  select * into cfg from public.ops_config where id = 1;
  select status, role into v_status, v_role from public.partners where user_id = auth.uid();
  if v_status is distinct from 'approved' then raise exception 'Only approved partners can book slots.'; end if;
  if p_role not in ('picker', 'delivery') then raise exception 'Invalid role.'; end if;
  if v_role is distinct from p_role then raise exception 'You can only book slots for your own role.'; end if;
  if p_hour < 0 or p_hour > 22 or p_hour % 2 <> 0 then raise exception 'Invalid slot time.'; end if;
  if p_hour < cfg.store_open_hour or p_hour >= cfg.store_close_hour then raise exception 'That slot is outside store hours.'; end if;
  v_now_date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_hour := extract(hour from now() at time zone 'Asia/Kolkata')::int;
  if p_date < v_now_date or (p_date = v_now_date and p_hour <= v_now_hour) then
    raise exception 'That slot has already started — book a later one.';
  end if;
  select count(*) into v_cnt from public.partner_slots
   where slot_date = p_date and start_hour = p_hour and role = p_role and status <> 'cancelled';
  if v_cnt >= 10 then raise exception 'This slot is full — 10 partners already booked it.'; end if;
  insert into public.partner_slots (partner_id, role, slot_date, start_hour)
  values (auth.uid(), p_role, p_date, p_hour);
end; $$;
