alter table public.profiles add column if not exists member_until timestamptz;

-- Plan config lives in settings.rewards.membership (admin-tunable). Default ₹99 / 30 days.
update public.settings
   set rewards = coalesce(rewards,'{}'::jsonb) || jsonb_build_object(
     'membership', coalesce(rewards->'membership', jsonb_build_object('enabled', true, 'price', 99, 'days', 30)))
 where id = 1;

-- Customer joins / renews by paying the fee from their NGS Wallet.
create or replace function public.join_membership()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_bal numeric; v_until timestamptz;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  v_cfg := coalesce((select rewards->'membership' from public.settings where id=1), '{}'::jsonb);
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then raise exception 'Membership isn''t available right now.'; end if;
  v_price := coalesce((v_cfg->>'price')::numeric, 99);
  v_days  := coalesce((v_cfg->>'days')::int, 30);
  select coalesce(sum(amount),0) into v_bal from public.customer_wallet where user_id = v_uid;
  if v_bal < v_price then
    raise exception 'You need ₹% in your NGS Wallet to join. Your balance is ₹%.', trunc(v_price)::text, trunc(v_bal)::text;
  end if;
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (v_uid, -v_price, 'spent', 'NGS Prime membership', v_uid);
  select member_until into v_until from public.profiles where id = v_uid;
  v_until := greatest(coalesce(v_until, now()), now()) + make_interval(days => v_days);
  update public.profiles set is_member = true, member_until = v_until,
         member_since = coalesce(member_since, now()) where id = v_uid;
  return jsonb_build_object('ok', true, 'member_until', v_until);
end $function$;
grant execute on function public.join_membership() to authenticated;

-- Admin activates membership for a customer (e.g. they paid cash / UPI at the shop).
create or replace function public.admin_grant_membership(p_user_id uuid, p_days int default 30)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_until timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select member_until into v_until from public.profiles where id = p_user_id;
  v_until := greatest(coalesce(v_until, now()), now()) + make_interval(days => p_days);
  update public.profiles set is_member = true, member_until = v_until,
         member_since = coalesce(member_since, now()) where id = p_user_id;
end $function$;
grant execute on function public.admin_grant_membership(uuid, int) to authenticated;

-- Expire lapsed memberships (keeps is_member honest for the free-delivery check).
create or replace function public.expire_memberships()
 returns void language sql security definer set search_path to 'public'
as $function$
  update public.profiles set is_member = false
   where is_member = true and member_until is not null and member_until < now();
$function$;

select cron.schedule('ngs-expire-memberships', '17 * * * *', 'select public.expire_memberships();');
