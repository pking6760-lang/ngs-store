-- Customer-facing: the assigned delivery partner's name + phone for MY order.
-- Only the order's owner can read it, and only once a rider is assigned.
create or replace function public.get_order_rider(p_order uuid)
 returns table(name text, phone text, delivery_state text)
 language sql stable security definer set search_path to 'public'
as $function$
  select pa.full_name, pa.phone, o.delivery_state
  from public.orders o
  join public.partners pa on pa.user_id = o.rider_id
  where o.id = p_order
    and o.user_id = auth.uid()
    and o.rider_id is not null;
$function$;
grant execute on function public.get_order_rider(uuid) to authenticated;
