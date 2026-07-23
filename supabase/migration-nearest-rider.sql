-- ════════════════════════════════════════════════════════════════════════════
-- Nearest-free-rider assignment.
--
-- Today pick_partner picks the free, online, slot-booked rider who has been
-- online longest (a fair queue). This adds distance awareness: online partners
-- ping their location, and among the eligible free riders we prefer the one
-- physically NEAREST the shop (fastest to collect + go). Everything else —
-- who's eligible (approved · online · free · booked this slot · under the COD
-- cash cap), the penalty/rollover loop, the owner fallback — is unchanged, so
-- the money logic is untouched. Riders without a fresh location simply fall
-- back to the old longest-online ordering.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Where each online partner currently is (pinged from the app while online).
alter table public.partner_presence add column if not exists lat    numeric;
alter table public.partner_presence add column if not exists lng    numeric;
alter table public.partner_presence add column if not exists loc_at timestamptz;

-- 2) An online partner reports their position. Own row only; safe to call often.
create or replace function public.partner_ping_location(p_lat numeric, p_lng numeric)
 returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_lat is null or p_lng is null then return; end if;
  update public.partner_presence
     set lat = p_lat, lng = p_lng, loc_at = now()
   where user_id = auth.uid();
end; $$;
grant execute on function public.partner_ping_location(numeric, numeric) to authenticated;

-- 3) pick_partner — identical eligibility, distance-aware ordering.
create or replace function public.pick_partner(p_role text, p_order uuid)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_total numeric; v_cod boolean; v_hour int; v_date date;
        v_uid uuid; v_tried uuid[]; v_shop_lat numeric; v_shop_lng numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select total, lower(coalesce(payment_method, '')) = 'cod', coalesce(dispatch_tried,'{}')
    into v_total, v_cod, v_tried from public.orders where id = p_order;
  v_date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour := (extract(hour from now() at time zone 'Asia/Kolkata')::int / 2) * 2;

  -- Shop coordinates (first shop) — used only to rank the eligible riders.
  select (shop_locations->0->>'lat')::numeric, (shop_locations->0->>'lng')::numeric
    into v_shop_lat, v_shop_lng from public.settings where id = 1;

  select pa.user_id into v_uid
  from public.partners pa
  join public.partner_presence pr on pr.user_id = pa.user_id
  join public.partner_slots sl on sl.partner_id = pa.user_id
       and sl.slot_date = v_date and sl.start_hour = v_hour and sl.role = p_role and sl.status <> 'cancelled'
  where pa.status = 'approved' and pa.role = p_role
    and pr.is_online = true and pr.active_order_id is null
    and pa.user_id <> all(v_tried)
    and (p_role <> 'delivery' or not v_cod or (public.partner_cash_in_hand(pa.user_id) + v_total) <= cfg.rider_cash_cap)
  order by
    -- Riders with a fresh position (last 5 min) come first, nearest shop first;
    -- everyone else falls back to the fair longest-online queue.
    case when v_shop_lat is not null and pr.lat is not null
              and pr.loc_at > now() - interval '5 minutes' then 0 else 1 end asc,
    case when v_shop_lat is not null and pr.lat is not null
              and pr.loc_at > now() - interval '5 minutes'
         then (pr.lat - v_shop_lat) * (pr.lat - v_shop_lat)
            + (pr.lng - v_shop_lng) * (pr.lng - v_shop_lng)
         else null end asc nulls last,
    pr.went_online_at asc nulls last
  limit 1
  for update of pr skip locked;
  return v_uid;
end; $function$;

select 'nearest-rider ready' as status;
