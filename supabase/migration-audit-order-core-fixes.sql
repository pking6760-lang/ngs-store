-- AUDIT FIXES for _place_order_core (Critical #1 + High #2).
--
-- #1 Points double-spend (online): online orders defer the points deduction to
--    mark_order_paid and nothing reserved them at checkout, so the same points
--    could discount several unpaid orders. Now the redeem step takes the per-user
--    advisory lock and subtracts points already committed to the user's unpaid
--    orders. Verified: two online orders redeeming 2000 pts split the real 2000.
--
-- #2 Client-trusted delivery distance: the server used the browser's
--    location.distanceKm for the fee band, free-delivery, the Prime perk and the
--    delivery-radius gate — so a faked small value underpaid and bypassed the
--    radius. Now distance is computed SERVER-SIDE (haversine) from the GPS pin vs
--    settings.shop_locations; the client value is ignored, and the order stores
--    the server distance. Verified: an 8km order faking distanceKm=1 is rejected;
--    a real 2km order stores 2km, not the faked 1.

CREATE OR REPLACE FUNCTION public._place_order_core(p_uid uuid, p_items jsonb, p_coupon text DEFAULT NULL::text, p_location jsonb DEFAULT NULL::jsonb, p_payment text DEFAULT 'upi'::text, p_address text DEFAULT NULL::text, p_wallet numeric DEFAULT 0, p_redeem_points integer DEFAULT 0, p_membership boolean DEFAULT false, p_enforce_store_open boolean DEFAULT true, p_device text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare
  v_reward_val numeric := 0;
  v_uid          uuid := p_uid;
  v_profile      public.profiles;
  v_settings     public.settings;
  v_ops          public.ops_config;
  v_line         jsonb;
  v_prod         public.products;
  v_qty          integer;
  v_unit         numeric;
  v_cost         numeric;
  v_bulk         numeric;
  v_member_savings numeric := 0;
  v_item_total   numeric := 0;
  v_qualify_total numeric := 0;
  v_reward_margin numeric := 0;
  v_item_margin  numeric := 0;
  v_cat_totals   jsonb := '{}';
  v_discount     numeric := 0;
  v_coupon       public.coupons;
  v_eligible     numeric;
  v_coupon_excl  numeric := 0;
  v_delivery     numeric := 0;
  v_handling     numeric := 0;
  v_surge        numeric := 0;
  v_small_cart   numeric := 0;
  v_total        numeric;
  v_wallet_bal   numeric := 0;
  v_wallet_use   numeric := 0;
  v_points       integer := 0;
  v_pts_bal      integer := 0;
  v_redeem_pts   integer := 0;
  v_redeem_rupees numeric := 0;
  v_rewards      jsonb;
  v_margin_ppr   numeric;
  v_min_margin_pct numeric;
  v_redeem_per   numeric;
  v_max_redeem_pct numeric;
  v_scratch      jsonb;
  v_pts_share    numeric;
  v_high_rupees  numeric;
  v_wallet_cut   numeric;
  v_wallet_max   numeric;
  v_high_margin  numeric := 0;
  v_points_total integer := 0;
  v_scratch_points integer := 0;
  v_scratch_wallet numeric := 0;
  v_order        public.orders;
  v_code         text;
  v_online       boolean := lower(coalesce(p_payment, '')) in ('razorpay', 'online', 'card', 'upi');
  v_status       text;
  v_cfg_mem      jsonb;
  v_add_member   boolean := false;
  v_member_fee   numeric := 0;
  v_member_days  int := 0;
  v_member_until timestamptz;
  v_is_member    boolean;
  v_has_thin     boolean := false;
  v_free_perk    boolean := false;
  v_life         jsonb;
  v_life_on      boolean := false;
  v_tier_key     text;
  v_windows      jsonb;
  v_pricing      jsonb;
  v_prc          jsonb;
  v_pct          numeric := null;
  v_tier         jsonb;
  v_n            int;
  v_welcome_ord  int;
  v_taper_ord    int;
  v_boost        numeric := 1;
  v_start_frac   numeric := 1;
  v_floor_frac   numeric := 0;
  v_frac         numeric := 1;
  v_perk         numeric := 1;
  v_mult         numeric := 1;
  v_bag          jsonb;
  v_levels       jsonb;
  v_pattern      text;
  v_ch           text;
  v_base_pts     int := 0;
  v_boost_pts    int := 0;
  v_extra_pts    int := 0;
  v_base_wal     numeric := 0;
  v_boost_wal    numeric := 0;
  v_extra_wal    numeric := 0;
  v_default_marg numeric;
  v_picker_cost  numeric := 0;
  v_rider_cost   numeric := 0;
  v_pick_lines   int := 0;
  v_pick_units   numeric := 0;
  v_far          boolean;
  v_free_thresh  numeric;
  v_sponsor      jsonb;
  v_sponsor_by   text;
  v_sponsor_amt  numeric := 0;
  v_dist_km      numeric;
  v_band_fee     numeric;
  v_profit_if_free numeric;
  v_room         numeric;
  v_items        jsonb;
  v_is_rain      boolean := false;
  v_is_peak      boolean := false;
  v_max_km       numeric;
  v_min_free_profit numeric;
  v_profit       numeric := 0;
  v_shop_floor   numeric := 0;
  v_budget       numeric := 0;
  v_pw_val       numeric := 0;
  v_scale        numeric := 1;
begin
  if v_uid is null then raise exception 'You must be signed in to place an order.'; end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'Profile not found.'; end if;
  if v_profile.customer_code is null then
    update public.profiles set customer_code = 'NGS' || nextval('public.customer_code_seq')
      where id = v_uid and customer_code is null;
  end if;

  select * into v_settings from public.settings where id = 1;
  if p_enforce_store_open and not v_settings.store_open then raise exception 'The store is currently closed.'; end if;
  select * into v_ops from public.ops_config where id = 1;
  v_default_marg := coalesce(v_ops.default_margin_pct, 0.15);

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  -- Combos dissolve into their components here, once, before anything else runs.
  -- Every rule below (margin, stock, picking lines/units, order_items) then sees
  -- ordinary products and needs no idea that combos exist.
  v_items := public.expand_combos(p_items);
  if jsonb_array_length(v_items) = 0 then raise exception 'Your cart is empty.'; end if;

  v_rewards        := v_settings.rewards;
  v_margin_ppr     := coalesce((v_rewards->>'marginPointsPerRupee')::numeric, 0.4);
  v_min_margin_pct := coalesce((v_rewards->>'pointsMinMarginPct')::numeric, 12);
  v_redeem_per     := coalesce((v_rewards->>'redeemPer')::numeric, 10);
  v_max_redeem_pct := coalesce((v_rewards->>'maxRedeemPct')::numeric, 20);
  v_scratch        := coalesce(v_rewards->'scratch', '{}'::jsonb);
  v_pts_share      := coalesce((v_scratch->>'pointsSharePct')::numeric, 30);
  v_high_rupees    := coalesce((v_scratch->>'highMarginRupees')::numeric, 20);
  v_wallet_cut     := coalesce((v_scratch->>'walletCutPct')::numeric, 10);
  v_wallet_max     := coalesce((v_scratch->>'walletMaxRupees')::numeric, 8);

  v_is_member := coalesce(v_profile.is_member, false);
  v_tier_key  := case
    when not v_is_member then 'normal'
    when coalesce(v_profile.membership_count, 1) >= 2 then 'renew'
    else 'prime' end;

  v_n      := coalesce(case when v_is_member then v_profile.member_order_count else v_profile.order_count end, 0) + 1;
  v_life   := coalesce(v_rewards->'lifecycle', '{}'::jsonb);
  v_life_on := coalesce((v_life->>'enabled')::boolean, true);
  if v_life_on then
    v_windows     := coalesce(v_life->'windows', '{}'::jsonb);
    v_welcome_ord := coalesce((v_windows->>v_tier_key)::int,
                       case v_tier_key when 'prime' then 10 when 'renew' then 7 else 6 end);
    v_taper_ord   := greatest(coalesce((v_life->>'taperOrders')::int, 15), 1);
    if v_n <= v_welcome_ord then v_frac := 0;
    elsif v_n <= v_welcome_ord + v_taper_ord then v_frac := (v_n - v_welcome_ord)::numeric / v_taper_ord;
    else v_frac := 1; end if;

    v_tier := coalesce(v_life->'member', '{}'::jsonb);
    v_boost := coalesce((v_tier->>'pointsBoost')::numeric, 2.5);
    v_bag    := coalesce(v_life->'bag', '{}'::jsonb);
    v_levels := coalesce(v_bag->'levels', '{"low":3,"mid":8,"high":15}'::jsonb);
    if v_tier_key = 'normal' then
      v_start_frac := coalesce((v_life->>'normalPct')::numeric, 55) / 100.0;
    elsif v_tier_key = 'renew' then
      v_start_frac := coalesce((v_life->>'renewalPct')::numeric, 30) / 100.0;
    else
      v_start_frac := 1.0;
    end if;
    v_floor_frac := coalesce((v_levels->>'low')::numeric, 3) / 100.0;
    if v_frac >= 1 then
      v_pattern := coalesce(v_bag->>(case when v_tier_key = 'normal' then 'normal' else 'prime' end),
                            case when v_tier_key = 'normal' then 'LLMLH' else 'LMLMH' end);
      v_ch := substr(v_pattern, (v_n % greatest(length(v_pattern), 1)) + 1, 1);
      v_perk := coalesce((v_levels->>(case v_ch when 'H' then 'high' when 'M' then 'mid' else 'low' end))::numeric, 3) / 100.0;
    else
      v_perk := v_start_frac - (v_start_frac - v_floor_frac) * v_frac;
    end if;
    v_mult := 1 + (v_boost - 1) * v_perk;

    -- Single source of truth, shared with coupon_quote() so a coupon preview
    -- can never price the cart differently from checkout.
    v_pct := public.lifecycle_price_pct(v_uid);
  end if;

  if coalesce(p_membership, false) and lower(coalesce(p_payment, '')) <> 'cod' then
    v_cfg_mem := coalesce(v_rewards->'membership', '{}'::jsonb);
    v_member_until := v_profile.member_until;
    if coalesce((v_cfg_mem->>'enabled')::boolean, true)
       and (v_member_until is null or v_member_until <= now()) then
      v_add_member  := true;
      v_member_fee  := coalesce((v_cfg_mem->>'price')::numeric, 99);
      v_member_days := coalesce((v_cfg_mem->>'days')::int, 30);
    end if;
  end if;

  -- Load the coupon up front so the item loop can tally how much of the cart
  -- its excluded categories/products cover (that value earns no discount and
  -- doesn't count toward the coupon's minimum).
  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    select * into v_coupon from public.coupons where code = upper(trim(p_coupon)) and active;
  end if;

  for v_line in select * from jsonb_array_elements(v_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then raise exception 'Bad quantity in cart.'; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A product in your cart is no longer available.'; end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;

    -- A combo component carries its allocated share of the pack price. Bulk and
    -- member tiers must NOT apply on top: the pack price is already the deal, and
    -- stacking a member discount on it would sell the pack below what was set.
    if v_line ? 'unit' then
      v_bulk := (v_line->>'unit')::numeric;
      v_unit := v_bulk;
    elsif v_prod.flash_price is not null and v_prod.flash_ends_at is not null
          and v_prod.flash_ends_at > now() then
      -- Active flash sale: one price for everyone. Like a combo component, the
      -- flash price is the whole deal — member and bulk discounts must NOT stack
      -- on top, or the flash could be pushed below the cost floor it was checked
      -- against. Expiry is automatic: once flash_ends_at passes, this branch is
      -- simply not taken and the normal price returns.
      v_bulk := v_prod.flash_price;
      v_unit := v_prod.flash_price;
    else
      v_bulk := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
      v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                        v_prod.member_price_floor, v_prod.mrp, v_pct);
    end if;
    v_member_savings := v_member_savings + greatest(v_bulk - v_unit, 0) * v_qty;

    v_item_total := v_item_total + v_unit * v_qty;
    v_pick_lines := v_pick_lines + 1;
    v_pick_units := v_pick_units + v_qty;
    -- Every item's value counts toward the bar. Whether the cart then EARNS
    -- free delivery is decided once, on the whole cart, by whether it still
    -- clears a profit with the fee waived. Per-item exclusion flags were a
    -- second mechanism answering the same question worse -- they can't see
    -- quantity, so they got ten bottles of oil wrong in one direction and
    -- twenty biscuits wrong in the other.
    v_qualify_total := v_qualify_total + v_unit * v_qty;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then v_item_margin := v_item_margin + (v_unit - v_cost) * v_qty;
    else v_item_margin := v_item_margin + v_unit * v_qty * v_default_marg; end if;
    v_cat_totals := jsonb_set(v_cat_totals, array[coalesce(v_prod.category,'_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category,'_'))::numeric, 0) + v_unit * v_qty));
    if v_coupon.code is not null
       and (v_coupon.category is null or v_coupon.category = '' or coalesce(v_prod.category,'') = v_coupon.category)
       and (coalesce(v_prod.category,'') = any(coalesce(v_coupon.excluded_categories, '{}'))
            or v_prod.id = any(coalesce(v_coupon.excluded_products, '{}'))) then
      v_coupon_excl := v_coupon_excl + v_unit * v_qty;
    end if;
  end loop;

  if not coalesce(p_membership, false)
     and v_item_total > 0
     and v_item_total < coalesce((v_rewards->>'minOrderValue')::numeric, 0) then
    raise exception 'Minimum order is Rs %. Please add a little more to place your order.',
      coalesce((v_rewards->>'minOrderValue')::numeric, 0)::int;
  end if;

  if v_coupon.code is not null then
    -- One-time coupons: refuse loudly (not silently) if this account OR this
    -- physical device has already redeemed the code — silent dropping would
    -- charge more than the total the customer was shown.
    if coalesce(v_coupon.single_use, false)
       and exists (select 1 from public.coupon_redemptions r
                    where r.code = v_coupon.code
                      and (r.user_id = v_uid
                           or (p_device is not null and r.device_hash = p_device))) then
      -- Deliberately does not mention the device check: it reads badly to an
      -- honest customer and tells a farmer exactly what to work around.
      raise exception 'You have already used the coupon %.', v_coupon.code;
    end if;
    if v_coupon.category is not null and v_coupon.category <> '' then
      v_eligible := coalesce((v_cat_totals->>v_coupon.category)::numeric, 0);
    else
      v_eligible := v_item_total;
    end if;
    -- Excluded categories/products neither count toward the minimum nor earn
    -- the discount.
    v_eligible := greatest(v_eligible - v_coupon_excl, 0);
    if v_eligible >= v_coupon.min_order and v_eligible > 0 then
      if v_coupon.type = 'percent' then v_discount := floor(v_eligible * v_coupon.value / 100);
      else v_discount := v_coupon.value; end if;
      v_discount := least(v_discount, v_eligible, v_item_total);
      -- A normal coupon never pays out more than the cart's margin, so the shop
      -- cannot be sold below cost — that is why it is advertised as "up to".
      -- A 'guaranteed' coupon is the owner's deliberate choice to honour the
      -- full value and absorb the difference.
      if not coalesce(v_coupon.guaranteed, false) then
        v_discount := least(v_discount, greatest(0, floor(v_item_margin)));
      end if;
    else
      v_coupon.code := null;
    end if;
  end if;

  if coalesce(p_redeem_points, 0) > 0 and v_redeem_per > 0 then
    -- Serialize this user's concurrent orders so the SAME points can't fund a
    -- discount on two not-yet-paid online orders (online defers the real points
    -- deduction to mark_order_paid). Same per-user lock the wallet reservation
    -- uses below; advisory_xact_lock is reentrant and held until commit.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select points into v_pts_bal from public.profiles where id = v_uid;
    -- Points already committed to this user's unpaid ('Awaiting payment') orders
    -- are unavailable to spend again.
    v_pts_bal := coalesce(v_pts_bal, 0) - coalesce((
      select sum(points_redeemed) from public.orders
      where user_id = v_uid and status = 'Awaiting payment' and coalesce(points_redeemed, 0) > 0), 0);
    v_redeem_rupees := floor(least(p_redeem_points, greatest(v_pts_bal, 0)) / v_redeem_per);
    v_redeem_rupees := least(v_redeem_rupees, floor(v_item_total * v_max_redeem_pct / 100), v_item_total - v_discount);
    if v_redeem_rupees < 0 then v_redeem_rupees := 0; end if;
    v_redeem_pts := (v_redeem_rupees * v_redeem_per)::int;
  end if;

  -- Prime perk (free delivery + no handling) is funded by the item margin. On
  -- thin-margin items (dairy, oil, tobacco — flagged manually or by margin) there is no
  -- margin to cover the driver, so waiving both fees puts the shop in loss.
  -- The perk therefore applies only when the cart has NO such items, OR the
  -- qualifying (non-exempt) total already earns free delivery on its own.
  -- Otherwise a member pays normal delivery + handling, exactly like a guest,
  -- so the driver is always covered. (Milk subscriptions are a separate prepaid
  -- channel and are unaffected.)
  -- Beyond the far zone, a higher free-delivery bar applies to EVERYONE —
  -- Prime's free-delivery perk is only guaranteed inside the near zone. A
  -- Rs 60 Prime order 3 km out costs the shop more to ride than it earns.
  -- Distance is computed SERVER-SIDE (haversine) from the customer's GPS pin vs
  -- the shop location(s). NEVER trust the client's location.distanceKm — it drives
  -- the delivery-fee band, the free-delivery threshold, the Prime free-delivery
  -- perk AND the delivery-radius gate, so a faked small value would underpay and
  -- bypass the radius. With no GPS pin we can't compute it, so treat as base zone
  -- (delivery then uses the typed address).
  if p_location is not null
     and (p_location->>'lat') is not null and (p_location->>'lng') is not null then
    select round(min(
      2 * 6371 * asin(least(1, sqrt(
        power(sin(radians(((s->>'lat')::numeric - (p_location->>'lat')::numeric) / 2)), 2)
        + cos(radians((p_location->>'lat')::numeric)) * cos(radians((s->>'lat')::numeric))
          * power(sin(radians(((s->>'lng')::numeric - (p_location->>'lng')::numeric) / 2)), 2)
      )))
    )::numeric, 2)
      into v_dist_km
    from jsonb_array_elements(coalesce(v_settings.shop_locations, '[]'::jsonb)) s
    where (s->>'lat') is not null and (s->>'lng') is not null;
  end if;
  v_dist_km := coalesce(v_dist_km, 0);
  -- The radius was enforced only in the app, so any crafted or stale request
  -- placed an order at any distance. That matters for money as well as reach:
  -- the fee bands are sized for the radius, while rider pay keeps climbing with
  -- distance, so every out-of-area order lost money (-Rs15 at 4.5km).
  select max_distance_km into v_max_km from public.settings where id = 1;
  if coalesce(v_max_km, 0) > 0 and v_dist_km > v_max_km then
    raise exception 'That address is outside our delivery area.';
  end if;
  v_far := v_dist_km >= coalesce(v_ops.far_zone_km, 999);
  v_free_thresh := case when v_far then coalesce(v_ops.free_delivery_far_above, v_settings.free_delivery_above)
                        else v_settings.free_delivery_above end;
  -- Delivery fee follows the same curve as rider pay: a doorstep drop costs the
  -- shop Rs18 and a 3km ride Rs55, so one flat fee would have the near customer
  -- subsidising the far one and still lose money at the edge of the radius.
  v_band_fee := case
    when v_dist_km >= coalesce(v_ops.far_zone_km_2, 1e9) then coalesce(v_ops.delivery_fee_far, v_settings.delivery_fee)
    when v_far                                          then coalesce(v_ops.delivery_fee_mid, v_settings.delivery_fee)
    else v_settings.delivery_fee end;
  -- Handling is charged to EVERYONE — Prime's perk is free delivery only.
  v_handling := v_settings.handling_fee;

  -- Surge, small cart and the fulfilment cost are all worked out BEFORE the
  -- free-delivery decision, because that decision now depends on them.
  -- RAIN and PEAK are two different surcharges funding two different people.
  -- Rain is paid to the RIDER, who is the one out in it. Peak is paid to the
  -- PICKER, because a busy hour is packing pressure, not weather. They used to
  -- be collapsed into one 'surge' mode whose whole bonus went to the rider, so
  -- a peak-hour surcharge paid the wrong person entirely.
  -- 'surge' is still accepted and read as rain, so nothing breaks mid-shift.
  v_is_rain := v_settings.delivery_mode in ('rain', 'both', 'surge');
  v_is_peak := v_settings.delivery_mode in ('peak', 'both');
  -- ONE flat surcharge, whichever condition is on and however many. Rain and
  -- peak can both be running; the customer still pays it once. What differs is
  -- who it funds: rain pays the rider, peak pays the picker, both pays both.
  if v_item_total > 0 and (v_is_rain or v_is_peak) then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;
  -- Small cart charge. Measured on the item total BEFORE discounts and points
  -- redemption, so a coupon cannot be used to duck under the threshold and skip
  -- the fee as well. Charged to EVERYONE including Prime members.
  if v_item_total > 0
     and v_item_total < coalesce(v_settings.small_cart_threshold, 0) then
    v_small_cart := greatest(coalesce(v_settings.small_cart_fee, 0), 0);
  end if;
  v_picker_cost := case when v_ops.coverage_picking = 'staff' then
      round(coalesce(v_ops.picker_pack_fee, 0) + v_pick_lines * coalesce(v_ops.picker_per_line, 0)
            + v_pick_units * coalesce(v_ops.picker_per_unit, 0)
            + case when v_is_peak then coalesce(v_ops.peak_bonus, 0) else 0 end, 2)
    else 0 end;
  v_rider_cost  := case when v_ops.coverage_delivery = 'staff' then
      greatest(coalesce(v_ops.rider_base, 0) + v_dist_km * coalesce(v_ops.rider_per_km, 0),
               coalesce(v_ops.rider_min, 0))
      + case when v_is_rain then coalesce(v_ops.rain_bonus, 0) else 0 end
    else 0 end;

  -- CAN THIS CART AFFORD ITS OWN RIDE?
  -- The old test was per item: an item whose margin was thin got its value
  -- struck off the qualifying total. That is the wrong shape of question.
  -- Quantity is invisible to it, so it was wrong in both directions —
  -- twenty ₹10 biscuits (₹29 margin) unlocked a ride that cost ₹62, while ten
  -- ₹190 oils (₹50 margin, ₹30 of it spare after the ride) were denied one.
  -- Asked of the whole cart it is simply: after waiving the fee, does the order
  -- still clear a small profit? Self-correcting as pay rates and costs move.
  -- The floor rises with the order. A flat Rs12 is 6% of a Rs200 cart and 1.2%
  -- of a Rs1000 one, so a big thin order could buy free delivery with pocket
  -- change. Rs12 on Rs200, Rs15 on Rs250, Rs24 on Rs400 -- it steps up.
  v_min_free_profit := greatest(coalesce(v_ops.min_free_delivery_profit, 8),
                                round(v_item_total * coalesce(v_ops.min_free_delivery_profit_pct, 0) / 100));
  v_profit_if_free := v_item_margin + (v_handling + v_surge + v_small_cart)
                      - v_picker_cost - v_rider_cost - v_discount - v_redeem_rupees;
  v_has_thin  := v_profit_if_free < v_min_free_profit;
  v_free_perk := v_is_member and not v_far and not v_has_thin;
  if v_qualify_total >= v_free_thresh and not v_has_thin then v_delivery := 0;
  elsif v_free_perk then v_delivery := 0;
  else v_delivery := v_band_fee; end if;

  -- Brand sponsorship. If a funded campaign can cover this delivery fee, the
  -- customer pays nothing for delivery and the fund is debited instead. This
  -- never touches product price — the shop's rule is that no item is ever sold
  -- below cost, so brand money buys fulfilment, not discounts. The draw is
  -- atomic, so two orders can never spend the same rupee.
  if v_delivery > 0 then
    v_sponsor := public._sponsor_draw(v_delivery);
    if v_sponsor is not null then
      v_sponsor_by  := v_sponsor->>'brand';
      v_sponsor_amt := v_delivery;
      v_delivery    := 0;
    end if;
  end if;
  -- ONE BUDGET FOR EVERY GIVEAWAY.
  -- Coupon, points and scratch used to be capped independently, each against
  -- the item margin, none aware of the others or of what fulfilment costs. So a
  -- "capped" coupon could take 100% of the margin and leave the rider unpaid,
  -- and points then took another 20% of the cart on top of that (-Rs253 at
  -- worst). Margin is not the budget: what is left AFTER the order pays for
  -- itself is. Each giveaway now draws from that one pot and shrinks it.
  -- The shop's keep. Breaking even is not the target — an order that clears
  -- Rs0 paid the rider and the picker and left the shop nothing for stock,
  -- rent or shrink. Giveaways stop at this line, not at zero.
  v_shop_floor := greatest(coalesce((v_life->>'shopFloorRupees')::numeric, 6),
                           round(v_item_total * coalesce((v_life->>'shopFloorPct')::numeric, 3) / 100));

  v_room := v_item_margin + (v_delivery + v_handling + v_surge + v_small_cart)
            - v_picker_cost - v_rider_cost - v_shop_floor;

  -- A guaranteed coupon is the owner's deliberate choice to honour the full
  -- value and absorb the difference, so it is NOT clipped here — but it still
  -- spends the budget, which is what stops points stacking on top of it.
  if v_discount > 0 and not coalesce(v_coupon.guaranteed, false) then
    v_discount := least(v_discount, greatest(0, floor(v_room)));
  end if;
  v_room := v_room - v_discount;

  -- Points are the one giveaway the customer triggers unprompted, on every
  -- order, so without a floor they drain each one to break-even: measured on a
  -- real Rs440 cart, EVERY points scenario landed on exactly Rs0.92 profit.
  -- Points are meant to share the upside, not consume it.
  if v_redeem_rupees > 0 then
    v_redeem_rupees := least(v_redeem_rupees, greatest(0, floor(v_room)));
    v_redeem_pts    := (v_redeem_rupees * v_redeem_per)::int;
    v_room          := v_room - v_redeem_rupees;
  end if;

  v_profit     := v_item_margin + (v_delivery + v_handling + v_surge + v_small_cart) - v_picker_cost - v_rider_cost - v_discount - v_redeem_rupees;

  -- Only the profit ABOVE the shop's floor can fund a reward, and never more
  -- than the cap. Before, the reward was a slice of the WHOLE profit, so the
  -- better an order did the more of it was handed straight back -- across 56
  -- real orders that was Rs117 of Rs1207, nearly a tenth of everything earned.
  v_reward_val := greatest(0, least(
      round(greatest(v_profit - v_shop_floor, 0) * coalesce((v_life->>'rewardSharePct')::numeric, 10) / 100),
      coalesce((v_life->>'rewardMaxRupees')::numeric, 8)));
  if coalesce((v_scratch->>'enabled')::boolean, true) = false
     or v_item_total < coalesce((v_scratch->>'minOrder')::numeric, 0)
     or not v_life_on
     -- Not every order gets a card. A reward that always arrives stops being a
     -- reward and just becomes a discount the customer prices in.
     or random() >= coalesce((v_scratch->>'orderChancePct')::numeric, 100) / 100 then
    v_reward_val := 0;
  end if;

  v_points := 0;
  if v_reward_val < 1 then
    v_scratch_points := 0; v_scratch_wallet := 0;
  elsif random() < coalesce((v_scratch->>'walletChancePct')::numeric, 10) / 100 then
    v_scratch_wallet := least(round(v_reward_val), coalesce((v_scratch->>'walletMaxRupees')::numeric, 8));
    v_scratch_points := 0;
  else
    v_scratch_points := floor(v_reward_val * greatest(v_redeem_per, 0));
    v_scratch_wallet := 0;
  end if;
  v_total := v_item_total - v_discount - v_redeem_rupees
             + v_delivery + v_handling + v_surge + v_small_cart + v_member_fee;

  if coalesce(p_wallet, 0) > 0 then
    -- Anti-farming: NGS Wallet money (referral/welcome credit, change, refunds)
    -- can only be spent on an order whose cart value covers the fulfilment cost.
    -- Below this floor a redeemed ₹30 would put the shop in loss on the delivery.
    if v_item_total < coalesce((v_rewards->>'walletMinOrder')::numeric, 199) then
      raise exception 'NGS Wallet money can be used on orders of ₹% or more. Add a little more to your cart to use it.',
        coalesce((v_rewards->>'walletMinOrder')::numeric, 199)::int;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_wallet_bal from public.customer_wallet where user_id = v_uid;
    v_wallet_use := least(p_wallet, greatest(v_wallet_bal, 0), v_total);
    if v_wallet_use < 0 then v_wallet_use := 0; end if;
    v_total := v_total - v_wallet_use;
  end if;

  if lower(coalesce(p_payment, '')) = 'wallet' and v_total > 0 then
    raise exception 'Your NGS Wallet doesn''t fully cover this order — please choose a payment method.';
  end if;

  if lower(coalesce(p_payment, '')) = 'cod'
     and coalesce(v_settings.cod_customer_limit, 0) > 0
     and v_total > v_settings.cod_customer_limit then
    raise exception 'Cash on delivery isn''t available above ₹%. Please pay online.',
      trunc(v_settings.cod_customer_limit)::text;
  end if;

  v_status := case when v_online then 'Awaiting payment' else 'Placed' end;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, surge_mode, small_cart_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, scratch_points, scratch_wallet,
    membership_fee, membership_days, member_bonus_points, member_bonus_wallet, welcome_discount,
    member_savings, sponsored_delivery_by, sponsored_amount
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge,
    case when v_is_rain and v_is_peak then 'both' when v_is_rain then 'rain'
         when v_is_peak then 'peak' else null end,
    v_small_cart, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else v_dist_km end,  -- server-computed distance, not client-supplied
    p_location, v_scratch_points, v_scratch_wallet,
    v_member_fee, case when v_add_member then v_member_days else null end,
    0, 0, 0, v_member_savings, v_sponsor_by, v_sponsor_amt
  ) returning * into v_order;

  -- Tie the draw to the order now that it exists, so the shop can show a brand
  -- exactly which deliveries their money paid for.
  if v_sponsor is not null then
    update public.sponsorship_ledger
       set order_id = v_order.id
     where id = (v_sponsor->>'ledgerId')::uuid;
  end if;

  -- Remember who redeemed which coupon on which device. A trigger frees the
  -- row again if the order is cancelled or the payment fails.
  if v_coupon.code is not null and v_discount > 0 then
    insert into public.coupon_redemptions (code, user_id, device_hash, order_id)
      values (v_coupon.code, v_uid, p_device, v_order.id);
  end if;

  if v_wallet_use > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_wallet_use, 'spent', 'Used on ' || v_code, v_order.id, v_uid);
  end if;

  if v_redeem_pts > 0 and not v_online then
    update public.profiles set points = points - v_redeem_pts where id = v_uid;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, -v_redeem_pts, 'Redeemed on ' || v_code);
  end if;

  for v_line in select * from jsonb_array_elements(v_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    if v_line ? 'unit' then
      v_unit := (v_line->>'unit')::numeric;
    elsif v_prod.flash_price is not null and v_prod.flash_ends_at is not null
          and v_prod.flash_ends_at > now() then
      -- Same flash rule as the pricing pass above: the flash price is charged
      -- flat, with no member/bulk discount stacked on top. Both passes must agree
      -- or the line stored would differ from the total the customer was shown.
      v_unit := v_prod.flash_price;
    else
      v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                        v_prod.member_price_floor, v_prod.mrp, v_pct);
    end if;
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      values (v_order.id, v_prod.id, v_prod.name, v_prod.icon, v_qty, v_unit);
    if not v_online and v_prod.stock is not null then
      update public.products set stock = greatest(0, stock - v_qty) where id = v_prod.id;
    end if;
  end loop;

  if not v_online and v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  if not v_online and v_add_member then
    perform public._activate_membership(v_uid, v_member_days);
  end if;

  if not v_online and coalesce(v_profile.order_count, 0) = 0 then
    declare v_rf public.referrals; v_amt numeric; v_cap numeric;
    begin
      select * into v_rf from public.referrals where referee_id = v_uid and status = 'pending' for update;
      if v_rf.id is not null then
        v_amt := coalesce(v_rf.reward_amount, 30);
        v_cap := greatest(least(v_amt, floor(greatest(v_profit, 0))), 0);
        if v_cap > 0 then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
          values (v_uid, v_cap, 'referral', 'Referral welcome reward', v_order.id, v_uid);
        end if;
        if v_cap > 0 then
          insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
            values (v_rf.referrer_id, v_cap, 'referral', 'A friend joined with your code', v_order.id, v_uid);
        end if;
        update public.referrals set status = 'rewarded', rewarded_at = now() where id = v_rf.id;
      end if;
    end;
  end if;

  if not v_online then
    update public.profiles set
      order_count = coalesce(order_count, 0) + 1,
      member_order_count = case when v_is_member then coalesce(member_order_count, 0) + 1 else member_order_count end
    where id = v_uid;
  end if;

  return v_order;
end;


$function$

;
