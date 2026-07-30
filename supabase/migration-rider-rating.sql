-- Extend the customer-facing rider lookup with the rider's REAL aggregate
-- rating (average of the star ratings customers have left on that rider's past
-- deliveries) plus how many ratings it's based on. The app only shows a star
-- score once there are enough ratings to be meaningful, so a brand-new rider
-- never displays an invented "4.9".
create or replace function public.get_order_rider(p_order uuid)
returns table(
  name text, phone text, delivery_state text,
  rider_lat numeric, rider_lng numeric, rider_loc_at timestamptz,
  rider_avg numeric, rider_rating_count integer
)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    pa.full_name, pa.phone, o.delivery_state, o.rider_lat, o.rider_lng, o.rider_loc_at,
    (select round(avg(x.rider_rating)::numeric, 1)
       from public.orders x where x.rider_id = o.rider_id and x.rider_rating > 0) as rider_avg,
    (select count(*)::int
       from public.orders x where x.rider_id = o.rider_id and x.rider_rating > 0) as rider_rating_count
  from public.orders o
  join public.partners pa on pa.user_id = o.rider_id
  where o.id = p_order
    and o.user_id = auth.uid()
    and o.rider_id is not null;
$$;
