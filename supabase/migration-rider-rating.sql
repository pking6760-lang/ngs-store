alter table public.orders add column if not exists rider_rating int;

-- Customer rates their delivery partner for a delivered order (owner only).
create or replace function public.rate_order_rider(p_order uuid, p_rating int)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1–5.'; end if;
  update public.orders set rider_rating = p_rating
   where id = p_order and user_id = auth.uid() and status = 'Delivered';
end $function$;
grant execute on function public.rate_order_rider(uuid, int) to authenticated;
