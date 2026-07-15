-- Block buying/renewing while a membership is still active (only allow once it
-- has ended) — server-side, so the UI can't be bypassed.
create or replace function public.join_membership()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_bal numeric; v_until timestamptz;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select member_until into v_until from public.profiles where id = v_uid;
  if v_until is not null and v_until > now() then
    raise exception 'You''re already a member until %. You can renew after it ends.', to_char(v_until,'DD Mon YYYY');
  end if;
  v_cfg := coalesce((select rewards->'membership' from public.settings where id=1), '{}'::jsonb);
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then raise exception 'Membership isn''t available right now.'; end if;
  v_price := coalesce((v_cfg->>'price')::numeric, 99);
  v_days  := coalesce((v_cfg->>'days')::int, 30);
  select coalesce(sum(amount),0) into v_bal from public.customer_wallet where user_id = v_uid;
  if v_bal < v_price then
    raise exception 'You need ₹% in your NGS Wallet. Your balance is ₹%.', trunc(v_price)::text, trunc(v_bal)::text;
  end if;
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (v_uid, -v_price, 'spent', 'NGS Prime membership', v_uid);
  perform public._activate_membership(v_uid, v_days);
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.create_membership_order()
 returns public.orders language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_p public.profiles; v_o public.orders; v_code text; v_until timestamptz;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select member_until into v_until from public.profiles where id = v_uid;
  if v_until is not null and v_until > now() then
    raise exception 'You''re already a member until %. You can renew after it ends.', to_char(v_until,'DD Mon YYYY');
  end if;
  v_cfg := coalesce((select rewards->'membership' from public.settings where id=1), '{}'::jsonb);
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then raise exception 'Membership isn''t available right now.'; end if;
  v_price := coalesce((v_cfg->>'price')::numeric, 99);
  v_days  := coalesce((v_cfg->>'days')::int, 30);
  -- reuse any still-unpaid membership order instead of stacking new ones
  select * into v_o from public.orders
    where user_id = v_uid and is_membership and status = 'Awaiting payment'
    order by created_at desc limit 1;
  if v_o.id is not null then return v_o; end if;
  select * into v_p from public.profiles where id = v_uid;
  v_code := 'NGSM' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_membership, membership_days
  ) values (
    v_code, v_uid, v_p.name, v_p.phone, 'Awaiting payment',
    v_price, v_price, 'razorpay', 'pending', true, v_days
  ) returning * into v_o;
  return v_o;
end $function$;
grant execute on function public.create_membership_order() to authenticated;

-- Clean up the test account: one 30-day membership, cancel the abandoned order.
update public.profiles
   set member_until = member_since + interval '30 days'
 where id = 'ab377ef1-996f-491b-9ab6-035ce5396687' and member_until > member_since + interval '31 days';
update public.orders set status = 'Cancelled'
 where is_membership and status = 'Awaiting payment';
