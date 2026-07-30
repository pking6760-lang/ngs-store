-- When the owner or a staff member delivers an order themselves from the admin
-- (no assigned delivery partner, so rider_id stays null), the customer's live
-- tracker previously showed no delivery-partner name at all. Give the store a
-- customer-facing delivery name so a self-delivered order looks like any normal
-- driver to the customer — they never see "owner"/"admin".
alter table public.settings add column if not exists delivery_display_name text;

-- Rider lookup: real partner when one is assigned (name + phone + live GPS +
-- aggregate rating); otherwise, once the order is actually out for delivery or
-- delivered, fall back to the store's delivery display name (no GPS/rating,
-- since there's no partner device streaming). Nothing shows before dispatch.
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
    coalesce(pa.full_name, nullif(btrim(s.delivery_display_name), ''), 'NGS Delivery') as name,
    coalesce(pa.phone, s.support_phone) as phone,
    o.delivery_state, o.rider_lat, o.rider_lng, o.rider_loc_at,
    case when o.rider_id is not null then
      (select round(avg(x.rider_rating)::numeric, 1)
         from public.orders x where x.rider_id = o.rider_id and x.rider_rating > 0)
    end as rider_avg,
    case when o.rider_id is not null then
      (select count(*)::int
         from public.orders x where x.rider_id = o.rider_id and x.rider_rating > 0)
    else 0 end as rider_rating_count
  from public.orders o
  left join public.partners pa on pa.user_id = o.rider_id
  cross join (select delivery_display_name, support_phone from public.settings where id = 1) s
  where o.id = p_order
    and o.user_id = auth.uid()
    and (o.rider_id is not null or o.status in ('Out for delivery', 'Delivered'));
$$;

grant execute on function public.get_order_rider(uuid) to authenticated;
