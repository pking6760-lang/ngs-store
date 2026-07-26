-- Customer-side economics rework — fees, Prime, free delivery, auto-pricing.
--
-- Companion to migration-payout-rework.sql. That one fixed what the shop PAYS;
-- this fixes what the shop CHARGES, because the two have to add up.
--
-- The headline problem: the free-delivery bar is a rupee threshold, but what
-- actually pays for a delivery is MARGIN, not turnover. Measured across the
-- live catalogue there is a clean gap between categories that can fund their
-- own delivery and categories that cannot:
--
--   tobacco   6.3% |  oil-ghee 6.5% | sauces 7.0% | dairy 7.8%   <- cannot
--   household 13.0% | beverages 14% | snacks 15% | atta 19% | instant 21%  <- can
--
-- A Rs199 cart of cigarettes yields Rs12.5 of margin and unlocks free delivery
-- that costs Rs18-55 in rider pay. Real example from the live data: order
-- NGS1582, three bottles of mustard oil, Rs570 -> free delivery, Rs15 margin,
-- and a loss once the rider was paid. Six bottles at 3km loses about Rs19.
--
-- Dairy was already hand-flagged free_delivery_exempt. Oil and tobacco were
-- not. Rather than hand-flagging forever (costs move, margins move), an item is
-- now excluded automatically whenever its margin falls below a configured
-- percentage. The manual flag stays and still works, as an override.

begin;

-- ── 1. Config ───────────────────────────────────────────────────────────────
alter table public.ops_config
  add column if not exists free_delivery_min_margin_pct numeric not null default 10;

alter table public.ops_config
  drop constraint if exists ops_config_customer_econ_sane;
alter table public.ops_config
  add constraint ops_config_customer_econ_sane check (
    free_delivery_min_margin_pct >= 0 and free_delivery_min_margin_pct <= 100
  );

-- Handling fee: Rs12 was 3x Blinkit's Rs4, and Zepto charges nothing at all.
-- It is the most visible "junk fee" on the bill and the one customers compare
-- first, so it comes down to Rs7. On a small order NGS is now Rs47 all-in
-- against Blinkit's Rs54; on a Rs250 order Rs7 against Blinkit's Rs4. The Rs5
-- per order given up here is repaid many times over by section 3 below.
update public.ops_config set handling_fee = 7 where id = 1;

-- Prime product discount: members were paying ~7% below the normal price,
-- which halved margin from 13.6% to 7.2%. On roughly 8 orders a month that
-- gives away more than the Rs99 membership brings in, before free delivery is
-- even counted. markupPct moves 6 -> 25: members keep a visible ~3% product
-- discount, margin holds near 10.7%, and Prime's real draw stays what it
-- should be — free delivery and boosted rewards, not below-cost groceries.
update public.settings
   set rewards = jsonb_set(rewards, '{member,markupPct}', '25'::jsonb, true)
 where id = 1;

-- Auto-pricing: fast movers were repriced to a 7% margin, which put them below
-- the 10% free-delivery line and made the shop's best sellers unable to pay for
-- their own delivery. 12% keeps them clearly the cheapest thing on the shelf
-- while still funding the ride.
update public.pricing_config set fast_margin = 0.12 where id = 1;

-- ── 2. A cost-free signal the customer app can read ────────────────────────
-- The cart has to show the same free-delivery maths the server will charge, but
-- product_costs must never reach a customer's device. So the margin test is
-- resolved server-side into a plain boolean and only the boolean is published.
alter table public.products
  add column if not exists free_delivery_exempt_auto boolean not null default false;

comment on column public.products.free_delivery_exempt_auto is
  'Maintained automatically: true when the item margin is below ops_config.free_delivery_min_margin_pct, meaning it does not count toward the free-delivery threshold. free_delivery_exempt remains a manual override and is unioned with this.';

create or replace function public.refresh_free_delivery_exempt()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_min numeric;
begin
  select coalesce(free_delivery_min_margin_pct, 10) into v_min from public.ops_config where id = 1;
  update public.products p
     set free_delivery_exempt_auto = v_auto.should_exempt
    from (
      select p2.id,
             -- No cost on file is treated as "counts", not "excluded": guessing
             -- against the customer on missing data would silently withhold free
             -- delivery on items the shop simply hasn't costed yet.
             case when c.cost is null or c.cost <= 0 or p2.price <= 0 then false
                  else ((p2.price - c.cost) / p2.price * 100) < v_min end as should_exempt
        from public.products p2
        left join public.product_costs c on c.product_id = p2.id
    ) as v_auto
   where p.id = v_auto.id
     and p.free_delivery_exempt_auto is distinct from v_auto.should_exempt;
end;
$$;

revoke all on function public.refresh_free_delivery_exempt() from public, anon;

select public.refresh_free_delivery_exempt();

commit;

-- ── 3. Order engine: margin-aware free-delivery bar + banded fee ───────────
-- An item counts toward the free-delivery threshold only if its own margin can
-- fund the ride (manual flag OR the auto margin flag keeps it out), and the
-- delivery fee follows the same distance curve as rider pay.
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
  v_dist_km      numeric;
  v_band_fee     numeric;
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

    v_pricing := coalesce(v_life->'pricing', '{}'::jsonb);
    if coalesce((v_pricing->>'enabled')::boolean, true) then
      v_prc := coalesce(v_pricing->v_tier_key, '{}'::jsonb);
      v_pct := coalesce((v_prc->>'start')::numeric,
                 case v_tier_key when 'prime' then 0 when 'renew' then 12 else 44 end)
             + (coalesce((v_prc->>'end')::numeric,
                 case v_tier_key when 'prime' then 40 when 'renew' then 32 else 64 end)
                - coalesce((v_prc->>'start')::numeric,
                 case v_tier_key when 'prime' then 0 when 'renew' then 12 else 44 end)) * v_frac;
    end if;
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

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then raise exception 'Bad quantity in cart.'; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A product in your cart is no longer available.'; end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;

    v_bulk := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    if coalesce(v_prod.no_rewards, false) then
      v_unit := v_bulk;
    else
      v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                        v_prod.member_price_floor, v_prod.mrp, v_pct);
    end if;
    v_member_savings := v_member_savings + greatest(v_bulk - v_unit, 0) * v_qty;

    v_item_total := v_item_total + v_unit * v_qty;
    v_pick_lines := v_pick_lines + 1;
    v_pick_units := v_pick_units + v_qty;
    -- An item counts toward the free-delivery bar only if its own margin can
    -- fund the ride. free_delivery_exempt is the owner's manual override;
    -- free_delivery_exempt_auto is maintained from the live margin. Either one
    -- keeps the item out, so a Rs480 cigarette cart (6% margin) can no longer
    -- unlock a delivery that costs more than the whole order earns.
    if not (coalesce(v_prod.free_delivery_exempt, false)
            or coalesce(v_prod.free_delivery_exempt_auto, false)) then
      v_qualify_total := v_qualify_total + v_unit * v_qty;
    end if;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then v_item_margin := v_item_margin + (v_unit - v_cost) * v_qty;
    else v_item_margin := v_item_margin + v_unit * v_qty * v_default_marg; end if;
    if not coalesce(v_prod.no_rewards, false) then
      if v_cost is not null and v_unit > 0
         and ((v_unit - v_cost) / v_unit) * 100 > v_min_margin_pct then
        v_reward_margin := v_reward_margin + (v_unit - v_cost) * v_qty;
      end if;
      if v_cost is not null and (v_unit - v_cost) >= v_high_rupees then
        v_high_margin := v_high_margin + (v_unit - v_cost) * v_qty;
      end if;
    end if;
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
    select points into v_pts_bal from public.profiles where id = v_uid;
    v_redeem_rupees := floor(least(p_redeem_points, greatest(coalesce(v_pts_bal, 0), 0)) / v_redeem_per);
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
  v_has_thin := v_item_total > v_qualify_total;   -- cart contains milk/dairy
  -- Beyond the far zone, a higher free-delivery bar applies to EVERYONE —
  -- Prime's free-delivery perk is only guaranteed inside the near zone. A
  -- Rs 60 Prime order 3 km out costs the shop more to ride than it earns.
  v_dist_km := coalesce((p_location->>'distanceKm')::numeric, 0);
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
  v_free_perk := v_is_member and not v_far
                 and (not v_has_thin or v_qualify_total >= v_settings.free_delivery_above);
  -- Handling is charged to EVERYONE — Prime's perk is free delivery only.
  v_handling := v_settings.handling_fee;
  if v_qualify_total >= v_free_thresh then v_delivery := 0;
  elsif v_free_perk then v_delivery := 0;
  else v_delivery := v_band_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;
  -- Small cart charge. Measured on the item total BEFORE discounts and points
  -- redemption, so a coupon cannot be used to duck under the threshold and skip
  -- the fee as well. Charged to EVERYONE including Prime members: the perk is
  -- free delivery, and a tiny basket still costs the shop the same to fulfil.
  if v_item_total > 0
     and v_item_total < coalesce(v_settings.small_cart_threshold, 0) then
    v_small_cart := greatest(coalesce(v_settings.small_cart_fee, 0), 0);
  end if;

  v_picker_cost := case when v_ops.coverage_picking = 'staff' then
      round(coalesce(v_ops.picker_pack_fee, 0) + v_pick_lines * coalesce(v_ops.picker_per_line, 0)
            + v_pick_units * coalesce(v_ops.picker_per_unit, 0), 2)
    else 0 end;
  v_rider_cost  := case when v_ops.coverage_delivery = 'staff' then
      greatest(coalesce(v_ops.rider_base, 0) + coalesce((p_location->>'distanceKm')::numeric, 0) * coalesce(v_ops.rider_per_km, 0),
               coalesce(v_ops.rider_min, 0))
      + case when v_surge > 0 then coalesce(v_ops.peak_bonus, 0) else 0 end
    else 0 end;
  v_profit     := v_item_margin + (v_delivery + v_handling + v_surge + v_small_cart) - v_picker_cost - v_rider_cost - v_discount - v_redeem_rupees;
  v_shop_floor := greatest(coalesce((v_life->>'shopFloorRupees')::numeric, 6),
                           round(v_item_total * coalesce((v_life->>'shopFloorPct')::numeric, 3) / 100));

  v_reward_val := greatest(0, least(
      round(greatest(v_profit, 0) * coalesce((v_life->>'rewardSharePct')::numeric, 10) / 100),
      v_profit - v_shop_floor));
  if coalesce((v_scratch->>'enabled')::boolean, true) = false
     or v_item_total < coalesce((v_scratch->>'minOrder')::numeric, 0)
     or not v_life_on then
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
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, small_cart_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, scratch_points, scratch_wallet,
    membership_fee, membership_days, member_bonus_points, member_bonus_wallet, welcome_discount,
    member_savings
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_small_cart, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location, v_scratch_points, v_scratch_wallet,
    v_member_fee, case when v_add_member then v_member_days else null end,
    0, 0, 0, v_member_savings
  ) returning * into v_order;

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

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    if coalesce(v_prod.no_rewards, false) then
      v_unit := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
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
-- ── 4. Rider peak bonus reads the same surge signal the customer is charged on.
--    ops_config.surge_on was never set by anything, so a customer could pay a
--    Rs25 surge charge while the rider received no peak bonus for that trip.
CREATE OR REPLACE FUNCTION public._complete_delivery(p_order uuid, p_tendered numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_earn numeric; v_rid uuid; v_total numeric; v_cash boolean;
        v_dist numeric; v_upd int;
        v_is_milk boolean; v_handling numeric; v_user uuid; v_code text;
        v_collected numeric; v_change numeric;
        v_change_cap numeric := 2000;   -- absolute backstop when no cash cap is configured
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, total, distance_km,
         (lower(coalesce(payment_method,'')) = 'cod' and coalesce(payment_status,'') <> 'paid'),
         (subscription_id is not null and not coalesce(is_subscription,false)), coalesce(handling,0),
         user_id, human_code
    into v_rid, v_total, v_dist, v_cash, v_is_milk, v_handling, v_user, v_code
    from public.orders where id = p_order;
  perform public._ensure_pool(p_order);
  if v_is_milk then
    v_earn := round(0.70 * v_handling, 2);
  else
    -- The peak bonus is keyed off the SAME signal the customer's surge charge
    -- is: settings.delivery_mode. ops_config.surge_on was never set by anything,
    -- so the customer could be charged surge while the rider got nothing for it.
    -- Rider pay = base + per km, from the first metre, floored at a per-order
    -- minimum. Deliberately blind to whether the customer is a Prime member —
    -- the ride is identical work either way, so it is paid identically. Prime
    -- is a discount the SHOP chooses to give the customer; it is funded out of
    -- item margin, never out of the rider's pay.
    v_earn := round(
        greatest(coalesce(cfg.rider_base, 0) + coalesce(v_dist, 0) * coalesce(cfg.rider_per_km, 0),
                 coalesce(cfg.rider_min, 0))
      + case when (select delivery_mode from public.settings where id = 1) = 'surge'
             then coalesce(cfg.peak_bonus, 0) else 0 end, 2);
  end if;

  -- Validate the cash BEFORE completing anything (raises roll the whole txn back).
  if v_cash then
    v_collected := greatest(coalesce(p_tendered, v_total), v_total);
    if p_tendered is not null
       and coalesce(cfg.rider_cash_cap, 0) > 0
       and v_collected > greatest(cfg.rider_cash_cap, v_total) then
      raise exception 'Cash above ₹% isn''t allowed — ask the customer to pay the rest by UPI.',
        trunc(cfg.rider_cash_cap)::text;
    end if;
    v_change := round(v_collected - v_total, 2);
    if v_change > v_change_cap then
      raise exception 'That is too much over the ₹% bill. Collect exact cash or give change.', round(v_total);
    end if;
  end if;

  update public.orders
     set delivery_state = 'delivered', delivered_at = now(), status = 'Delivered',
         payment_status = case when v_cash then 'paid' else payment_status end
   where id = p_order and delivery_state <> 'delivered';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  insert into public.order_economics (order_id, rider_earning)
    values (p_order, case when v_rid is not null then v_earn else 0 end)
    on conflict (order_id) do update set rider_earning = excluded.rider_earning, updated_at = now();
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_rid, p_order, 'earning', v_earn, case when v_is_milk then 'Milk round' else 'Delivery' end, auth.uid());
    if v_cash then
      insert into public.wallet_ledger (partner_id, order_id, kind, amount, cash_delta, note, created_by)
      values (v_rid, p_order, 'cod_collected', -v_collected, v_collected,
              case when v_change > 0
                   then 'Cash collected ₹' || v_collected || ' — ₹' || v_change || ' change to customer wallet'
                   else 'Cash collected (COD)' end,
              auth.uid());
      if v_change > 0 and v_user is not null then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (v_user, v_change, 'change',
                'Change from ' || coalesce(v_code, 'your order') || ' (paid cash, no change)', p_order, v_rid);
      end if;
    end if;
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
end; $function$
;
-- ── 5. Auto-pricing refreshes the margin flag in the same pass, so it can
--    never go stale after a reprice moves margins.
CREATE OR REPLACE FUNCTION public.smart_reprice()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg  public.pricing_config;
  v_deep numeric;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

  insert into public.product_costs (product_id)
    select id from public.products on conflict (product_id) do nothing;

  with sales as (
    select oi.product_id as pid,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '1 day'),  0)::int as d1,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '3 days'), 0)::int as d3,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '7 days'), 0)::int as d7,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '14 days'),0)::int as d14,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '30 days'),0)::int as d30
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'Cancelled' and o.created_at >= now() - interval '30 days'
    group by oi.product_id
  ),
  scored as (
    select p.id, pc.cost, p.mrp, p.created_at,
      coalesce(s.d1,0) d1, coalesce(s.d3,0) d3, coalesce(s.d7,0) d7,
      coalesce(s.d14,0) d14, coalesce(s.d30,0) d30,
      round(30.0 * (
        4*coalesce(s.d1,0)/1.0 + 3*coalesce(s.d3,0)/3.0 + 3*coalesce(s.d7,0)/7.0
        + 2*coalesce(s.d14,0)/14.0 + 1*coalesce(s.d30,0)/30.0
      ) / 13.0)::int as vscore
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    left join sales s on s.pid = p.id
  ),
  calc as (
    select *,
      case
        when cost is null or mrp is null or mrp < cost then 'unpriced'
        when d30 = 0 and created_at < now() - interval '30 days' then 'dead'
        when d30 between 1 and cfg.slow_max then 'slow'
        when vscore >= cfg.fast_min then 'fast'
        else 'steady'
      end as tier
    from scored
  ),
  priced as (
    select *,
      case tier
        when 'unpriced' then null
        when 'dead'   then round(cost * (1 + cfg.clearance_markup))
        when 'fast'   then round(cost / (1 - cfg.fast_margin))
        when 'slow'   then round(cost / (1 - cfg.slow_margin))
        else               round(cost / (1 - cfg.steady_margin))
      end as raw
    from calc
  ),
  priv as (
    update public.product_costs pc set
      speed_tier = pr.tier, units_30d = pr.d30, velocity_score = pr.vscore,
      sold_1d = pr.d1, sold_3d = pr.d3, sold_7d = pr.d7, sold_14d = pr.d14, sold_30d = pr.d30
    from priced pr where pc.product_id = pr.id
    returning pr.id, pr.tier, pr.raw, pr.cost, pr.mrp, pr.vscore
  )
  update public.products p set
    price = case when priv.tier = 'unpriced' or p.manual_price then p.price
                 else least(greatest(least(priv.raw, priv.mrp), ceil(priv.cost * (1 + cfg.floor_markup))), priv.mrp)
            end,
    auto_priced_at = case when priv.tier = 'unpriced' or p.manual_price then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  -- Bestseller badge: owner override wins, else automatic (sells fast).
  update public.products p set hot = case
      when pc.hot_override = 'pin'  then true
      when pc.hot_override = 'hide' then false
      else coalesce(pc.velocity_score, 0) >= cfg.fast_min
    end
    from public.product_costs pc where pc.product_id = p.id;

  -- Bulk tiers from the (possibly hand-set) selling price.
  update public.products p set
    bulk_tiers = public.build_bulk_tiers(p.price, pc.cost, ceil(pc.cost * (1 + cfg.floor_markup)), cfg)
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced');

  -- Best Prices flag: pinned + real discount (>=5%) + fast-sellers, minus hidden.
  update public.products set bait = false where bait;
  update public.products p set bait = true
    from public.product_costs pc where pc.product_id = p.id and pc.bait_override = 'pin';
  update public.products p set bait = true
    from public.product_costs pc
    where pc.product_id = p.id and p.active and p.mrp is not null and p.price < p.mrp
      and (p.mrp - p.price)::numeric / nullif(p.mrp, 0) >= 0.05
      and coalesce(pc.bait_override, '') <> 'hide';
  with cand as (
    select pc.product_id from public.product_costs pc
    join public.products p on p.id = pc.product_id
    where pc.speed_tier = 'fast' and p.active and coalesce(pc.bait_override, '') <> 'hide'
    order by pc.velocity_score desc, pc.units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.product_id;

  v_deep := coalesce((select (rewards->'lifecycle'->'pricing'->>'deepMarginPct')::numeric
                        from public.settings where id = 1), 7);
  update public.products p set
    member_price_floor = case
      when pc.cost is null or p.mrp is null or pc.speed_tier = 'unpriced' then null
      else least(p.mrp, ceil(pc.cost * (1 + v_deep / 100))) end
    from public.product_costs pc where pc.product_id = p.id;

  update public.products set member_factor = 1.0, member_bonus_kind = null
    where member_factor <> 1.0 or member_bonus_kind is not null;

  -- Repricing moves margins, so the "can this item fund its own delivery?"
  -- flag has to be recomputed in the same pass or it goes stale.
  perform public.refresh_free_delivery_exempt();
end; $function$
;