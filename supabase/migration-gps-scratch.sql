-- ═══════ LIVE RIDER GPS + SCRATCH REWARD ═══════
alter table public.orders add column if not exists rider_lat numeric;
alter table public.orders add column if not exists rider_lng numeric;
alter table public.orders add column if not exists rider_loc_at timestamptz;
alter table public.orders add column if not exists scratch_claimed boolean not null default false;
alter table public.orders add column if not exists scratch_reward jsonb;

-- Rider streams their GPS while on an active delivery. Only the assigned rider
-- can write, and only until the order is delivered/returned.
create or replace function public.partner_update_location(p_order uuid, p_lat numeric, p_lng numeric)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.orders
     set rider_lat = p_lat, rider_lng = p_lng, rider_loc_at = now()
   where id = p_order
     and rider_id = auth.uid()
     and coalesce(delivery_state,'') not in ('delivered','returned');
end $function$;
grant execute on function public.partner_update_location(uuid, numeric, numeric) to authenticated;

-- Customer-facing rider info now includes the live GPS position (owner only).
create or replace function public.get_order_rider(p_order uuid)
 returns table(name text, phone text, delivery_state text, rider_lat numeric, rider_lng numeric, rider_loc_at timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$
  select pa.full_name, pa.phone, o.delivery_state, o.rider_lat, o.rider_lng, o.rider_loc_at
  from public.orders o
  join public.partners pa on pa.user_id = o.rider_id
  where o.id = p_order
    and o.user_id = auth.uid()
    and o.rider_id is not null;
$function$;
grant execute on function public.get_order_rider(uuid) to authenticated;

-- Scratch reward: the customer scratches once, after delivery, to claim a
-- reward. Idempotent per order. (Reward tiers are a placeholder for now — small
-- points reward — until the scratch-coupon config is defined.)
create or replace function public.claim_scratch_reward(p_order uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare o public.orders; v_amt int; v_reward jsonb;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.user_id <> auth.uid() then raise exception 'Order not found.'; end if;
  if o.status <> 'Delivered' then raise exception 'You can scratch after delivery.'; end if;
  if o.is_return then raise exception 'No reward on a return.'; end if;
  if coalesce(o.scratch_claimed, false) then
    return coalesce(o.scratch_reward, jsonb_build_object('type','points','amount',0));
  end if;
  -- Placeholder reward: 10–40 reward points.
  v_amt := floor(random() * 31)::int + 10;
  v_reward := jsonb_build_object('type','points','amount',v_amt);
  update public.orders set scratch_claimed = true, scratch_reward = v_reward where id = p_order;
  update public.profiles set points = points + v_amt where id = o.user_id;
  insert into public.points_ledger (user_id, order_id, delta, reason)
    values (o.user_id, o.id, v_amt, 'Scratch card reward on ' || o.human_code);
  return v_reward;
end $function$;
grant execute on function public.claim_scratch_reward(uuid) to authenticated;
