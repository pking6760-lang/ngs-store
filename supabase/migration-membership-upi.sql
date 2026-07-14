alter table public.orders add column if not exists is_membership boolean not null default false;
alter table public.orders add column if not exists membership_days int;

-- Shared membership activation (used by wallet-pay and online-pay).
create or replace function public._activate_membership(p_uid uuid, p_days int)
 returns void language sql security definer set search_path to 'public'
as $function$
  update public.profiles
     set is_member = true,
         member_until = greatest(coalesce(member_until, now()), now()) + make_interval(days => p_days),
         member_since = coalesce(member_since, now())
   where id = p_uid;
$function$;

-- Wallet-pay path (unchanged behaviour, now via the shared activator).
create or replace function public.join_membership()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_bal numeric;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
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

-- Online-pay path: make a tiny membership "order" that runs through the SAME
-- Razorpay QR / webhook pipeline as a normal order.
create or replace function public.create_membership_order()
 returns public.orders language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_cfg jsonb; v_price numeric; v_days int; v_p public.profiles; v_o public.orders; v_code text;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  v_cfg := coalesce((select rewards->'membership' from public.settings where id=1), '{}'::jsonb);
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then raise exception 'Membership isn''t available right now.'; end if;
  v_price := coalesce((v_cfg->>'price')::numeric, 99);
  v_days  := coalesce((v_cfg->>'days')::int, 30);
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

-- Don't dispatch or alarm on membership orders.
create or replace function public.dispatch_order(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_uid uuid; v_is_return boolean; v_is_mem boolean;
begin
  select is_return, is_membership into v_is_return, v_is_mem from public.orders where id = p_order;
  if coalesce(v_is_mem,false) then return; end if;
  select * into cfg from public.ops_config where id = 1;
  if not coalesce(v_is_return,false)
     and cfg.coverage_picking = 'staff'
     and (select picker_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('picker', p_order);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', p_order);
    end if;
  end if;
  if (coalesce(v_is_return,false) or cfg.coverage_delivery = 'staff')
     and (select rider_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('delivery', p_order);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', p_order);
    end if;
  end if;
end; $function$;

create or replace function public.notify_admin_new_order()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(NEW.is_return, false) or coalesce(NEW.is_membership, false) then return NEW; end if;
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret','94075e1969c27b54b99c866927cf19a9'),
    body := jsonb_build_object('type','INSERT','record', to_jsonb(NEW))
  );
  return NEW;
end;
$function$;
