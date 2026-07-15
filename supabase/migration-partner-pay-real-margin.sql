-- FIX 1: the partner-pay margin now uses the REAL buying price (product_costs),
-- the same source the points system and the dashboard already use — instead of
-- product_ops.cost_price, which was empty and forced a flat 15% guess.
create or replace function public.order_compute_margin(p_order uuid)
 returns numeric language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(sum(
    case when pc.cost is not null then oi.qty * (oi.price - pc.cost)
         else oi.qty * oi.price * (select default_margin_pct from public.ops_config where id = 1) end
  ), 0)
  from public.order_items oi
  left join public.product_costs pc on pc.product_id = oi.product_id
  where oi.order_id = p_order;
$function$;

-- FIX 2: the pay pool is the order's REAL PROFIT AFTER giveaways, then the
-- rider/picker take their share of that. We subtract what was given out of
-- margin (coupon, points redeemed, points earned, scratch), keep the operating
-- fees (handling / delivery / surge) in the pool, and never let it go negative.
-- (Wallet-paid amounts are NOT subtracted — that money was already counted as a
-- cost when it was refunded, so deducting again would double-count.)
create or replace function public.order_pool(p_order uuid)
 returns numeric language plpgsql stable security definer set search_path to 'public'
as $function$
declare o public.orders; v_redeem numeric; v_reward_cost numeric; v_net numeric;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then return 0; end if;
  v_redeem := coalesce((select (rewards->>'redeemPer')::numeric from public.settings where id = 1), 10);
  if v_redeem <= 0 then v_redeem := 10; end if;
  v_reward_cost :=
      coalesce(o.discount, 0)                       -- coupon discount
    + coalesce(o.points_discount, 0)                -- points the customer redeemed
    + coalesce(o.points_earned, 0) / v_redeem       -- ₹ value of points given now
    + coalesce(o.scratch_points, 0) / v_redeem      -- ₹ value of points held for scratch
    + coalesce(o.scratch_wallet, 0);                -- scratch wallet cash
  v_net := greatest(public.order_compute_margin(p_order) - v_reward_cost, 0);
  return v_net
       + coalesce(o.handling, 0) + coalesce(o.delivery_fee, 0) + coalesce(o.surge_fee, 0);
end $function$;
