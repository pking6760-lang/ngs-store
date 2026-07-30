-- AUDIT FIX (Low): reject implausible partner GPS pings. A rider legitimately
-- moves within the delivery area; a ping tens of km away is a GPS glitch or a
-- spoof. Ignore anything absurdly far from the nearest shop so bad coordinates
-- can't corrupt nearest-rider dispatch. (Fine-grained spoof-to-shop is bounded by
-- the non-delivery penalty engine; full anti-spoofing needs device attestation.)
create or replace function public.partner_ping_location(p_lat numeric, p_lng numeric)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_km numeric;
begin
  if p_lat is null or p_lng is null then return; end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then return; end if;

  -- distance to the nearest shop (haversine, km)
  select min(
    2 * 6371 * asin(least(1, sqrt(
      power(sin(radians(((s->>'lat')::numeric - p_lat) / 2)), 2)
      + cos(radians(p_lat)) * cos(radians((s->>'lat')::numeric))
        * power(sin(radians(((s->>'lng')::numeric - p_lng) / 2)), 2)
    )))
  ) into v_km
  from jsonb_array_elements(coalesce((select shop_locations from public.settings where id = 1), '[]'::jsonb)) s
  where (s->>'lat') is not null and (s->>'lng') is not null;

  -- No shop configured → accept (can't judge). Otherwise ignore pings > 60 km out.
  if v_km is not null and v_km > 60 then return; end if;

  update public.partner_presence
     set lat = p_lat, lng = p_lng, loc_at = now()
   where user_id = auth.uid();
end; $$;
