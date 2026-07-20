-- Add the customer's phone to each milk-round stop so the driver can call them.
drop function if exists public.get_my_round();
create or replace function public.get_my_round()
 returns table(order_id uuid, code text, state text, location jsonb, address text,
               customer text, phone text, items jsonb, earning numeric, total numeric)
 language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code, o.delivery_state, o.location, o.address, o.customer_name, o.user_phone,
    (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty))
       from public.order_items oi where oi.order_id = o.id),
    round(0.70 * coalesce(o.handling,0), 2), o.total
  from public.orders o
  where o.rider_id = v_uid
    and o.subscription_id is not null and not coalesce(o.is_subscription,false)
    and o.delivery_state not in ('delivered','returned')
    and o.deliver_on = v_today
  order by o.distance_km asc nulls last, o.human_code;
end; $function$;
revoke execute on function public.get_my_round() from public, anon;
grant execute on function public.get_my_round() to authenticated;

select 'get_my_round returns phone' as status;
