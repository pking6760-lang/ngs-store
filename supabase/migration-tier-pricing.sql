-- ════════════════════════════════════════════════════════════════════════════
-- Tiered member pricing — the discount IS the price, fixed per tier, never random.
--
-- Every priced product gets a public "deep anchor" (cost + a minimum margin).
-- A member's price sits between that anchor and the MRP at a per-tier position:
--     New Prime      deepest  (start  0% of the span → settles at 40%)
--     Renewed Prime  middle   (start 12%             → settles at 32%)
--     Normal member  smallest (start 44%             → settles at 64%)
-- (On a ₹100-MRP item bought at ₹70 with a 7% floor: anchor ₹75 → Prime ₹75→85,
--  Renewal ₹78→83, Normal ₹86→91 — the owner's example.)
--
-- The honeymoon "limit" is per tier: Normal 6, New Prime 10, Renewal 7 orders,
-- then the price tapers little-by-little to the settled position. The shown
-- price never exceeds the normal shelf price (guests' smart price) or the MRP,
-- and never dips below the anchor — no item ever sells at a loss.
--
-- This REPLACES the invisible Mode A/B member factor and the separate "welcome
-- discount" bill line: the discount now lives in the price itself. Points and
-- the scratch coupon stay the (random) reward channels.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists member_price_floor numeric;

-- Per-tier windows + pricing positions (admin-tunable).
update public.settings
   set rewards = jsonb_set(rewards, '{lifecycle,windows}',
       coalesce(rewards->'lifecycle'->'windows', '{"normal":6,"prime":10,"renew":7}'::jsonb))
 where id = 1;
update public.settings
   set rewards = jsonb_set(rewards, '{lifecycle,pricing}',
       coalesce(rewards->'lifecycle'->'pricing',
                '{"enabled":true,"deepMarginPct":7,"prime":{"start":0,"end":40},"renew":{"start":12,"end":32},"normal":{"start":44,"end":64}}'::jsonb))
 where id = 1;

-- Settled-state surprise bag for points/scratch (NOT the price): every 5 orders
-- mixes Low/Mid/High perk levels. Normal: 3 low, 1 mid, 1 high. Prime (incl.
-- renewed): 2 low, 2 mid, 1 high. Levels are % of the peak perk — never zero.
update public.settings
   set rewards = jsonb_set(rewards, '{lifecycle,bag}',
       coalesce(rewards->'lifecycle'->'bag',
                '{"levels":{"low":3,"mid":8,"high":15},"normal":"LLMLH","prime":"LMLMH"}'::jsonb))
 where id = 1;

-- Shared unit-price helper: the better of the bulk price and the tier price.
-- MUST stay in lockstep with tierUnitPrice() in src/lib/bulk.js.
create or replace function public.member_tier_unit(p_price numeric, p_tiers jsonb, p_qty int, p_floor numeric, p_mrp numeric, p_pct numeric)
 returns numeric language sql stable
as $function$
  select case
    when p_floor is null or p_mrp is null or p_mrp <= p_floor or p_pct is null
      then public.bulk_unit_price(p_price, p_tiers, p_qty)
    else least(public.bulk_unit_price(p_price, p_tiers, p_qty),
               least(p_mrp, greatest(p_floor, round(p_floor + (p_mrp - p_floor) * p_pct / 100))))
  end;
$function$;

-- ── smart_reprice(): compute the deep anchor; retire the Mode A/B factor ─────
create or replace function public.smart_reprice()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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
    price = case when priv.tier = 'unpriced' then p.price
                 else least(greatest(least(priv.raw, priv.mrp), ceil(priv.cost * (1 + cfg.floor_markup))), priv.mrp)
            end,
    hot = (priv.vscore >= cfg.fast_min),
    auto_priced_at = case when priv.tier = 'unpriced' then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  update public.products p set
    bulk_tiers = public.build_bulk_tiers(p.price, ceil(pc.cost * (1 + cfg.floor_markup)), cfg)
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced');

  update public.products set bait = false where bait;
  update public.products p set bait = true
    from public.product_costs pc where pc.product_id = p.id and pc.bait_override = 'pin';
  with cand as (
    select pc.product_id from public.product_costs pc
    join public.products p on p.id = pc.product_id
    where pc.speed_tier = 'fast' and p.active and coalesce(pc.bait_override, '') <> 'hide'
    order by pc.velocity_score desc, pc.units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.product_id;

  -- Tier pricing anchor: the deepest price any member can ever pay (cost + a
  -- minimum margin) — so no item ever sells at a loss. Public by design: it is
  -- literally the price shown to a brand-new Prime member.
  v_deep := coalesce((select (rewards->'lifecycle'->'pricing'->>'deepMarginPct')::numeric
                        from public.settings where id = 1), 7);
  update public.products p set
    member_price_floor = case
      when pc.cost is null or p.mrp is null or pc.speed_tier = 'unpriced' then null
      else least(p.mrp, ceil(pc.cost * (1 + v_deep / 100))) end
    from public.product_costs pc where pc.product_id = p.id;

  -- Mode A/B is retired — tier pricing replaces it. Neutralize the old factors.
  update public.products set member_factor = 1.0, member_bonus_kind = null
    where member_factor <> 1.0 or member_bonus_kind is not null;
end; $function$;

-- ── place_order(): charge the tier price; the discount lives in the price ────
create or replace function public.place_order(p_items jsonb, p_coupon text default null, p_location jsonb default null, p_payment text default 'upi', p_address text default null, p_wallet numeric default 0, p_redeem_points integer default 0, p_membership boolean default false)
 returns public.orders language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_profile      public.profiles;
  v_settings     public.settings;
  v_ops          public.ops_config;
  v_line         jsonb;
  v_prod         public.products;
  v_qty          integer;
  v_unit         numeric;
  v_cost         numeric;
  v_item_total   numeric := 0;
  v_qualify_total numeric := 0;
  v_reward_margin numeric := 0;
  v_item_margin  numeric := 0;
  v_cat_totals   jsonb := '{}';
  v_discount     numeric := 0;
  v_coupon       public.coupons;
  v_eligible     numeric;
  v_delivery     numeric := 0;
  v_handling     numeric := 0;
  v_surge        numeric := 0;
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
  v_online       boolean := lower(coalesce(p_payment, '')) in ('razorpay', 'online', 'card');
  v_status       text;
  v_cfg_mem      jsonb;
  v_add_member   boolean := false;
  v_member_fee   numeric := 0;
  v_member_days  int := 0;
  v_member_until timestamptz;
  v_is_member    boolean;
  v_life         jsonb;
  v_life_on      boolean := false;
  v_tier_key     text;               -- 'normal' | 'prime' | 'renew'
  v_windows      jsonb;
  v_pricing      jsonb;
  v_prc          jsonb;
  v_pct          numeric := null;    -- price position anchor→MRP for THIS order
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
  if not v_settings.store_open then raise exception 'The store is currently closed.'; end if;
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
    -- Per-tier honeymoon window (the "limit"): Normal 6, New Prime 10, Renewal 7.
    v_windows     := coalesce(v_life->'windows', '{}'::jsonb);
    v_welcome_ord := coalesce((v_windows->>v_tier_key)::int,
                       case v_tier_key when 'prime' then 10 when 'renew' then 7 else 6 end);
    v_taper_ord   := greatest(coalesce((v_life->>'taperOrders')::int, 15), 1);
    if v_n <= v_welcome_ord then v_frac := 0;
    elsif v_n <= v_welcome_ord + v_taper_ord then v_frac := (v_n - v_welcome_ord)::numeric / v_taper_ord;
    else v_frac := 1; end if;

    -- Points/scratch perk (the surprise rewards; the price is separate & fixed).
    -- During the honeymoon: high (only a NEW Prime member = 100%). After the
    -- limit: each order draws from the 5-order surprise bag (Low/Mid/High).
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
      -- Settled: draw this order's level from the tier's bag pattern.
      v_pattern := coalesce(v_bag->>(case when v_tier_key = 'normal' then 'normal' else 'prime' end),
                            case when v_tier_key = 'normal' then 'LLMLH' else 'LMLMH' end);
      v_ch := substr(v_pattern, (v_n % greatest(length(v_pattern), 1)) + 1, 1);
      v_perk := coalesce((v_levels->>(case v_ch when 'H' then 'high' when 'M' then 'mid' else 'low' end))::numeric, 3) / 100.0;
    else
      v_perk := v_start_frac - (v_start_frac - v_floor_frac) * v_frac;
    end if;
    v_mult := 1 + (v_boost - 1) * v_perk;

    -- Tier PRICE position (fixed, never random): start% → settled% of the
    -- anchor→MRP span, same taper. MUST match tierUnitPrice() in the client.
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

  -- Membership add-on requires PREPAYMENT (online or wallet). COD is collected at
  -- delivery, so activating at placement would let someone place a COD order with
  -- membership and then refuse delivery = free Prime. Block it for COD.
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

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then raise exception 'Bad quantity in cart.'; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A product in your cart is no longer available.'; end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;

    v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                      v_prod.member_price_floor, v_prod.mrp, v_pct);

    v_item_total := v_item_total + v_unit * v_qty;
    if not coalesce(v_prod.free_delivery_exempt, false) then
      v_qualify_total := v_qualify_total + v_unit * v_qty;
    end if;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then v_item_margin := v_item_margin + (v_unit - v_cost) * v_qty;
    else v_item_margin := v_item_margin + v_unit * v_qty * v_default_marg; end if;
    if v_cost is not null and v_unit > 0
       and ((v_unit - v_cost) / v_unit) * 100 > v_min_margin_pct then
      v_reward_margin := v_reward_margin + (v_unit - v_cost) * v_qty;
    end if;
    if v_cost is not null and (v_unit - v_cost) >= v_high_rupees then
      v_high_margin := v_high_margin + (v_unit - v_cost) * v_qty;
    end if;
    v_cat_totals := jsonb_set(v_cat_totals, array[coalesce(v_prod.category,'_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category,'_'))::numeric, 0) + v_unit * v_qty));
  end loop;

  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    select * into v_coupon from public.coupons where code = upper(trim(p_coupon)) and active;
    if v_coupon.code is not null then
      if v_coupon.category is not null and v_coupon.category <> '' then
        v_eligible := coalesce((v_cat_totals->>v_coupon.category)::numeric, 0);
      else
        v_eligible := v_item_total;
      end if;
      if v_eligible >= v_coupon.min_order and v_eligible > 0 then
        if v_coupon.type = 'percent' then v_discount := floor(v_eligible * v_coupon.value / 100);
        else v_discount := v_coupon.value; end if;
        v_discount := least(v_discount, v_item_total);
      else
        v_coupon.code := null;
      end if;
    end if;
  end if;

  if coalesce(p_redeem_points, 0) > 0 and v_redeem_per > 0 then
    select points into v_pts_bal from public.profiles where id = v_uid;
    v_redeem_rupees := floor(least(p_redeem_points, greatest(coalesce(v_pts_bal, 0), 0)) / v_redeem_per);
    v_redeem_rupees := least(v_redeem_rupees, floor(v_item_total * v_max_redeem_pct / 100), v_item_total - v_discount);
    if v_redeem_rupees < 0 then v_redeem_rupees := 0; end if;
    v_redeem_pts := (v_redeem_rupees * v_redeem_per)::int;
  end if;

  v_handling := case when v_is_member then 0 else v_settings.handling_fee end;
  if v_qualify_total >= v_settings.free_delivery_above then v_delivery := 0;
  elsif v_profile.is_member then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  -- Points/scratch earned, boosted by the tier perk; bounded by real profit so
  -- the shop always keeps its floor (rewards only ever come from the order).
  v_base_pts  := floor(greatest(v_reward_margin, 0) * v_margin_ppr);
  v_boost_pts := floor(greatest(v_reward_margin, 0) * v_margin_ppr * v_mult);
  v_extra_pts := greatest(v_boost_pts - v_base_pts, 0);
  v_base_wal  := least(round(greatest(v_high_margin, 0) * greatest(v_wallet_cut, 0) / 100), v_wallet_max);
  v_boost_wal := least(round(greatest(v_high_margin, 0) * greatest(v_wallet_cut, 0) / 100 * v_mult), round(v_wallet_max * v_mult));
  v_extra_wal := greatest(v_boost_wal - v_base_wal, 0);

  v_picker_cost := case when v_ops.coverage_picking = 'staff' then coalesce(v_ops.picker_pack_fee, 0) else 0 end;
  v_rider_cost  := case when v_ops.coverage_delivery = 'staff' then
      (case when v_is_member then coalesce(v_ops.rider_member_base, v_ops.rider_base) else v_ops.rider_base end)
      + greatest(coalesce((p_location->>'distanceKm')::numeric, 0) - coalesce(v_ops.rider_free_km, 0), 0) * coalesce(v_ops.rider_per_km, 0)
      + case when v_surge > 0 then coalesce(v_ops.peak_bonus, 0) else 0 end
    else 0 end;
  v_profit     := v_item_margin + (v_delivery + v_handling + v_surge) - v_picker_cost - v_rider_cost;
  v_shop_floor := greatest(coalesce((v_life->>'shopFloorRupees')::numeric, 6),
                           round(v_item_total * coalesce((v_life->>'shopFloorPct')::numeric, 3) / 100));
  v_budget := greatest(0, v_profit - v_shop_floor);
  v_pw_val := (v_extra_pts::numeric / nullif(v_redeem_per, 0)) + v_extra_wal;
  if v_life_on and coalesce(v_pw_val, 0) > v_budget and v_pw_val > 0 then
    v_scale := greatest(0, v_budget / v_pw_val);
    v_extra_pts := floor(v_extra_pts * v_scale);
    v_extra_wal := floor(v_extra_wal * v_scale);
  end if;

  v_points_total   := v_base_pts + v_extra_pts;
  v_scratch_wallet := v_base_wal + v_extra_wal;
  v_scratch_points := round(v_points_total * greatest(v_pts_share, 0) / 100);
  v_points         := greatest(v_points_total - v_scratch_points, 0);
  if coalesce((v_scratch->>'enabled')::boolean, true) = false
     or v_item_total < coalesce((v_scratch->>'minOrder')::numeric, 0) then
    v_points := v_points_total; v_scratch_points := 0; v_scratch_wallet := 0;
  end if;

  v_total := v_item_total - v_discount - v_redeem_rupees
             + v_delivery + v_handling + v_surge + v_member_fee;

  if coalesce(p_wallet, 0) > 0 then
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
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, points_earned,
    points_redeemed, points_discount, total, wallet_used, payment_method, payment_status,
    address, distance_km, location, scratch_points, scratch_wallet,
    membership_fee, membership_days, member_bonus_points, member_bonus_wallet, welcome_discount
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location, v_scratch_points, v_scratch_wallet,
    v_member_fee, case when v_add_member then v_member_days else null end,
    0, 0, 0
  ) returning * into v_order;

  if v_wallet_use > 0 and not v_online then
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
    v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                      v_prod.member_price_floor, v_prod.mrp, v_pct);
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

  if not v_online then
    update public.profiles set
      order_count = coalesce(order_count, 0) + 1,
      member_order_count = case when v_is_member then coalesce(member_order_count, 0) + 1 else member_order_count end
    where id = v_uid;
  end if;

  return v_order;
end;
$function$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean) to authenticated;

-- Populate the anchors right away.
select public.smart_reprice();
