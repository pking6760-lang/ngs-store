-- Free delivery: ask the question of the CART, not of each item.
--
-- The old test struck a thin-margin item's value off the qualifying total. That
-- is the wrong shape of question — a per-item flag cannot see quantity, so it
-- was wrong in both directions:
--
--   20 x Rs10 biscuits   margin Rs29, ride+pick Rs62  ->  got free delivery, lost Rs23
--   10 x Rs190 oil       margin Rs50, ride+pick Rs30  ->  denied it, though Rs30 spare
--
-- One bottle of oil genuinely cannot fund a ride. Ten easily can. Asked of the
-- whole cart the rule is simply: after waiving the fee, does the order still
-- clear a small profit? Nothing to classify, nothing to keep in sync, and it
-- self-corrects when pay rates or buying costs move.
--
-- Verified across three cart shapes and four distances:
--
--                        0.5km    1km     2km     3km
--   10 x oil Rs190       +35 F   +30 F   +14 F    -2 charge
--   20 x biscuits Rs10    -2 c    -7 c   -23 c   -39 charge
--   cigarettes Rs480     +17 F   +12 F    -4 c   -20 charge
--
-- quote_delivery() below gives the customer's cart the same answer BEFORE
-- checkout, so the bill never changes under them. Buying costs stay server-side:
-- the RPC returns a fee, never a margin.

begin;

alter table public.ops_config
  add column if not exists min_free_delivery_profit numeric not null default 8;

comment on column public.ops_config.min_free_delivery_profit is
  'Minimum profit (Rs) an order must still clear after waiving the delivery fee, for free delivery to be granted.';

-- What the cart shows. Same arithmetic as _place_order_core, on the same inputs,
-- so the two cannot disagree. Read-only: no order, no stock move, no side effect.
create or replace function public.quote_delivery(p_items jsonb,
                                                 p_distance_km numeric default 0,
                                                 p_is_member boolean default false)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ops public.ops_config; v_settings public.settings;
  v_line jsonb; v_prod public.products; v_qty int; v_unit numeric; v_cost numeric;
  v_item_total numeric := 0; v_qualify numeric := 0; v_margin numeric := 0;
  v_lines int := 0; v_units int := 0;
  v_default_marg numeric; v_dist numeric := coalesce(p_distance_km, 0);
  v_far boolean; v_thresh numeric; v_band numeric; v_handling numeric;
  v_surge numeric := 0; v_small numeric := 0;
  v_picker numeric; v_rider numeric; v_profit_if_free numeric;
  v_min_profit numeric; v_affordable boolean; v_fee numeric;
begin
  select * into v_ops from public.ops_config where id = 1;
  select * into v_settings from public.settings where id = 1;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('deliveryFee', 0, 'handling', 0, 'smallCart', 0,
                              'surge', 0, 'freeDelivery', false, 'shortfall', 0);
  end if;
  v_default_marg := coalesce(v_ops.default_margin_pct, 0.15);

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    continue when v_qty <= 0;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    continue when v_prod.id is null;
    -- Mirror the order engine's unit price, including bulk tiers and member
    -- tiering, so the quoted fee is decided on the prices actually charged.
    if coalesce(v_prod.no_rewards, false) or not p_is_member then
      v_unit := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    else
      v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                        v_prod.member_price_floor, v_prod.mrp,
                                        public.lifecycle_price_pct(auth.uid()));
    end if;
    v_item_total := v_item_total + v_unit * v_qty;
    v_lines := v_lines + 1;
    v_units := v_units + v_qty;
    if not coalesce(v_prod.free_delivery_exempt, false) then
      v_qualify := v_qualify + v_unit * v_qty;
    end if;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then v_margin := v_margin + (v_unit - v_cost) * v_qty;
    else v_margin := v_margin + v_unit * v_qty * v_default_marg; end if;
  end loop;

  v_far    := v_dist >= coalesce(v_ops.far_zone_km, 999);
  v_thresh := case when v_far then coalesce(v_ops.free_delivery_far_above, v_settings.free_delivery_above)
                   else v_settings.free_delivery_above end;
  v_band   := case
    when v_dist >= coalesce(v_ops.far_zone_km_2, 1e9) then coalesce(v_ops.delivery_fee_far, v_settings.delivery_fee)
    when v_far                                        then coalesce(v_ops.delivery_fee_mid, v_settings.delivery_fee)
    else v_settings.delivery_fee end;
  v_handling := v_settings.handling_fee;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;
  if v_item_total > 0 and v_item_total < coalesce(v_settings.small_cart_threshold, 0) then
    v_small := greatest(coalesce(v_settings.small_cart_fee, 0), 0);
  end if;
  v_picker := case when v_ops.coverage_picking = 'staff' then
      round(coalesce(v_ops.picker_pack_fee,0) + v_lines * coalesce(v_ops.picker_per_line,0)
            + v_units * coalesce(v_ops.picker_per_unit,0), 2) else 0 end;
  v_rider := case when v_ops.coverage_delivery = 'staff' then
      greatest(coalesce(v_ops.rider_base,0) + v_dist * coalesce(v_ops.rider_per_km,0),
               coalesce(v_ops.rider_min,0))
      + case when v_surge > 0 then coalesce(v_ops.peak_bonus,0) else 0 end else 0 end;

  v_min_profit := coalesce(v_ops.min_free_delivery_profit, 8);
  v_profit_if_free := v_margin + (v_handling + v_surge + v_small) - v_picker - v_rider;
  v_affordable := v_profit_if_free >= v_min_profit;

  if (v_qualify >= v_thresh and v_affordable)
     or (p_is_member and not v_far and v_affordable) then v_fee := 0;
  else v_fee := v_band; end if;

  -- `shortfall` is what the cart shows as "add Rs X more". Only meaningful when
  -- the cart is short on VALUE; a cart that is short on margin is not told to
  -- add a specific amount, because no exact amount is true — it depends
  -- entirely on what they add next.
  return jsonb_build_object(
    'deliveryFee',  v_fee,
    'handling',     v_handling,
    'smallCart',    v_small,
    'surge',        v_surge,
    'freeDelivery', v_fee = 0,
    'threshold',    v_thresh,
    'qualifying',   round(v_qualify, 2),
    'affordable',   v_affordable,
    'shortfall',    greatest(0, round(v_thresh - v_qualify)));
end; $$;

revoke all on function public.quote_delivery(jsonb, numeric, boolean) from public;
grant execute on function public.quote_delivery(jsonb, numeric, boolean) to anon, authenticated;

commit;
