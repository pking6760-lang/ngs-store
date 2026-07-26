-- Money system: one source of truth for customer pricing, and dead config removed.
--
-- Audit of the whole money path turned up three problems that all share a root
-- cause — the same rule written more than once, or written and never wired up:
--
--  1. DRIFT. The lifecycle "honeymoon" price percentage is computed inside
--     _place_order_core from rewards.lifecycle.pricing (25 -> 75 as a customer
--     matures). coupon_quote computed its own from rewards.member.markupPct, a
--     completely different number. So the coupon preview priced the cart
--     differently from checkout, which means the margin cap it applied was
--     computed against the wrong margin.
--
--  2. DEAD REWARD CONFIG. rewards.earnPer (399) and rewards.earnPoints (50) look
--     like a 1.25% points-back scheme, and the admin can edit them, but
--     _place_order_core sets points to zero unconditionally before writing the
--     order. Every point a customer has ever earned came from scratch cards.
--
--  3. DEAD PAYOUT CONFIG. rider_tier1_pct, rider_tier2_pct, rider_taper_break,
--     rider_floor, picker_tier1_pct, picker_tier2_pct, picker_taper_break and
--     picker_slot_min survive from an abandoned percentage-of-order payout
--     design. Nothing reads them. picker_slot_min is worse than unused: it is
--     published to the partner app as a promised slot minimum that is never paid.
--
-- This migration fixes (1) by extracting the rule into one function both callers
-- use, and clears (3). (2) is left switched off but the config is removed so it
-- cannot mislead — see the note on the points model below.

begin;

-- ── 1. One lifecycle pricing rule ──────────────────────────────────────────
-- Returns the "markup percent" fed to member_tier_unit: 0 means price at the
-- deep floor, 100 means price at MRP. It rises as a customer matures, so the
-- honeymoon discount tapers off. Extracted verbatim from _place_order_core so
-- there is exactly one definition of it in the system.
create or replace function public.lifecycle_price_pct(p_uid uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_profile   public.profiles;
  v_rewards   jsonb;
  v_life      jsonb;
  v_pricing   jsonb;
  v_prc       jsonb;
  v_tier_key  text;
  v_n         int;
  v_welcome   int;
  v_taper     int;
  v_frac      numeric;
  v_start     numeric;
  v_end       numeric;
begin
  select * into v_profile from public.profiles where id = p_uid;
  select rewards into v_rewards from public.settings where id = 1;
  v_life := coalesce(v_rewards->'lifecycle', '{}'::jsonb);
  if not coalesce((v_life->>'enabled')::boolean, true) then return null; end if;

  v_pricing := coalesce(v_life->'pricing', '{}'::jsonb);
  if not coalesce((v_pricing->>'enabled')::boolean, true) then return null; end if;

  v_tier_key := case
    when not coalesce(v_profile.is_member, false) then 'normal'
    when coalesce(v_profile.membership_count, 1) >= 2 then 'renew'
    else 'prime' end;

  v_n := coalesce(case when coalesce(v_profile.is_member, false)
                       then v_profile.member_order_count
                       else v_profile.order_count end, 0) + 1;

  v_welcome := coalesce((coalesce(v_life->'windows', '{}'::jsonb)->>v_tier_key)::int,
                 case v_tier_key when 'prime' then 10 when 'renew' then 7 else 6 end);
  v_taper   := greatest(coalesce((v_life->>'taperOrders')::int, 15), 1);

  if v_n <= v_welcome then v_frac := 0;
  elsif v_n <= v_welcome + v_taper then v_frac := (v_n - v_welcome)::numeric / v_taper;
  else v_frac := 1; end if;

  v_prc   := coalesce(v_pricing->v_tier_key, '{}'::jsonb);
  v_start := coalesce((v_prc->>'start')::numeric,
               case v_tier_key when 'prime' then 0 when 'renew' then 12 else 44 end);
  v_end   := coalesce((v_prc->>'end')::numeric,
               case v_tier_key when 'prime' then 40 when 'renew' then 32 else 64 end);
  return v_start + (v_end - v_start) * v_frac;
end;
$$;

revoke all on function public.lifecycle_price_pct(uuid) from public, anon;
grant execute on function public.lifecycle_price_pct(uuid) to authenticated;

-- ── 2. Remove payout config nothing reads ──────────────────────────────────
-- Leaving these in place is how the payout system came to look arbitrary: the
-- screen showed eight dials, six of which did nothing.
alter table public.ops_config
  drop column if exists rider_tier1_pct,
  drop column if exists rider_tier2_pct,
  drop column if exists rider_taper_break,
  drop column if exists rider_floor,
  drop column if exists picker_tier1_pct,
  drop column if exists picker_tier2_pct,
  drop column if exists picker_taper_break,
  drop column if exists picker_slot_min,
  drop column if exists rider_free_km;

-- get_partner_config published picker_slot_min to the partner app as a promised
-- slot minimum that no code ever paid. The real guarantee is now
-- slot_guarantee_enabled + the hourly floors, applied by slot_sweep().
create or replace function public.get_partner_config()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'storeOpenHour',  o.store_open_hour,
    'storeCloseHour', o.store_close_hour,
    'riderCashCap',   o.rider_cash_cap,
    'slotGuarantee',  case when coalesce(o.slot_guarantee_enabled, false)
                           then jsonb_build_object('riderHourly', o.rider_floor_hourly,
                                                   'pickerHourly', o.picker_floor_hourly,
                                                   'slotHours', o.slot_length_hours)
                           else null end,
    'storePhone',     (select regexp_replace(coalesce(support_phone,''), '\D', '', 'g')
                         from public.settings where id = 1)
  ) from public.ops_config o where o.id = 1;
$$;

-- ── 3. Remove the points config that never applied ─────────────────────────
-- earnPer/earnPoints implied 50 points per Rs399 spent. _place_order_core sets
-- points to 0 before every insert, so this has never paid out. Points come only
-- from scratch cards, which are profit-shared and self-limiting. Removing the
-- keys so the admin is not editing a number that does nothing.
update public.settings
   set rewards = (rewards - 'earnPer' - 'earnPoints')
 where id = 1;

commit;

-- ── 4. get_my_task: show the partner the SAME figure they will be paid ─────
-- This still carried the old payout formula (free-km, lower Prime base) and
-- referenced rider_member_base after it was dropped, so the rider task screen
-- was erroring outright. Now it mirrors partner_mark_packed/_complete_delivery.
CREATE OR REPLACE FUNCTION public.get_my_task()
 RETURNS TABLE(order_id uuid, code text, task_role text, state text, is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb, is_return boolean, earning numeric, packed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; cfg public.ops_config;
begin
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  select * into cfg from public.ops_config where id = 1;
  return query
  select o.id, o.human_code,
    case when o.picker_id = v_uid then 'picker' else 'delivery' end,
    case when o.picker_id = v_uid then o.picker_state else o.delivery_state end,
    (lower(coalesce(o.payment_method, '')) = 'cod'),
    (coalesce(o.payment_status,'') = 'paid'),
    case when lower(coalesce(o.payment_method, '')) = 'cod' then o.total else null end,
    case when o.rider_id = v_uid then o.location else null end,
    case when o.picker_id = v_uid or coalesce(o.is_return,false) then
      (select jsonb_agg(jsonb_build_object(
                 'name', oi.name, 'qty', oi.qty,
                 'barcode', coalesce(p.barcode, ''), 'productId', oi.product_id))
         from public.order_items oi
         left join public.products p on p.id = oi.product_id
        where oi.order_id = o.id)
      else null end,
    coalesce(o.is_return, false),
    case
      -- Must match partner_mark_packed() and _complete_delivery() exactly, or
      -- the partner sees one figure on the task card and a different one lands
      -- in their wallet.
      when o.picker_id = v_uid then round(
          coalesce(cfg.picker_pack_fee, 0)
        + (select count(*) from public.order_items oi where oi.order_id = o.id) * coalesce(cfg.picker_per_line, 0)
        + (select coalesce(sum(oi.qty),0) from public.order_items oi where oi.order_id = o.id) * coalesce(cfg.picker_per_unit, 0)
      , 2)
      when o.rider_id = v_uid then round(
          greatest(coalesce(cfg.rider_base,0) + coalesce(o.distance_km,0) * coalesce(cfg.rider_per_km,0),
                   coalesce(cfg.rider_min,0))
        + case when (select delivery_mode from public.settings where id = 1) = 'surge'
               then coalesce(cfg.peak_bonus,0) else 0 end
      , 2)
      else 0 end,
    (o.status in ('Packed', 'Out for delivery', 'Delivered')
     or coalesce(o.is_return, false)
     or (o.subscription_id is not null and not coalesce(o.is_subscription, false)))
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
     and not (o.subscription_id is not null and not coalesce(o.is_subscription,false))
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$
;
-- ── 5. Both pricing engines now call lifecycle_price_pct() ─────────────────
CREATE OR REPLACE FUNCTION public.coupon_quote(p_items jsonb, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_profile      record;
  v_coupon       record;
  v_line         jsonb;
  v_prod         record;
  v_qty          int;
  v_unit         numeric;
  v_bulk         numeric;
  v_cost         numeric;
  v_pct          numeric := 0;
  v_default_marg numeric;
  v_item_total   numeric := 0;
  v_item_margin  numeric := 0;
  v_cat_totals   jsonb := '{}'::jsonb;
  v_excl         numeric := 0;
  v_eligible     numeric;
  v_face         numeric;
  v_discount     numeric := 0;
  v_n            int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Bad cart.');
  end if;
  -- Bound the work: a cart is small, and this is callable by any signed-in user.
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('ok', false, 'error', 'Cart too large.');
  end if;

  select * into v_coupon from public.coupons
   where code = upper(trim(coalesce(p_code, ''))) and active;
  if v_coupon.code is null then
    return jsonb_build_object('ok', false, 'error', 'This coupon isn''t valid.');
  end if;

  select coalesce(default_margin_pct, 0.15) into v_default_marg from public.ops_config where id = 1;
  select * into v_profile from public.profiles where id = v_uid;
  -- Same lifecycle rule the order engine uses. Reading a different config key
  -- here meant the quote priced the cart differently from checkout, so the
  -- margin cap it applied was computed against the wrong margin.
  v_pct := public.lifecycle_price_pct(v_uid);

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_qty := coalesce((v_line->>'qty')::int, 0);
    continue when v_qty <= 0 or v_qty > 1000;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    continue when v_prod.id is null;

    v_bulk := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    if coalesce(v_prod.no_rewards, false) then
      v_unit := v_bulk;
    else
      v_unit := public.member_tier_unit(v_prod.price, v_prod.bulk_tiers, v_qty,
                                        v_prod.member_price_floor, v_prod.mrp, v_pct);
    end if;

    v_item_total := v_item_total + v_unit * v_qty;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then v_item_margin := v_item_margin + (v_unit - v_cost) * v_qty;
    else v_item_margin := v_item_margin + v_unit * v_qty * v_default_marg; end if;

    v_cat_totals := jsonb_set(v_cat_totals, array[coalesce(v_prod.category, '_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category, '_'))::numeric, 0) + v_unit * v_qty));

    if (v_coupon.category is null or v_coupon.category = ''
        or coalesce(v_prod.category, '') = v_coupon.category)
       and (coalesce(v_prod.category, '') = any(coalesce(v_coupon.excluded_categories, '{}'))
            or v_prod.id = any(coalesce(v_coupon.excluded_products, '{}'))) then
      v_excl := v_excl + v_unit * v_qty;
    end if;
  end loop;

  if v_coupon.category is not null and v_coupon.category <> '' then
    v_eligible := coalesce((v_cat_totals->>v_coupon.category)::numeric, 0);
  else
    v_eligible := v_item_total;
  end if;
  v_eligible := greatest(v_eligible - v_excl, 0);

  if v_eligible < v_coupon.min_order or v_eligible <= 0 then
    return jsonb_build_object('ok', false, 'error', 'This cart does not qualify for that coupon.');
  end if;

  if v_coupon.type = 'percent' then v_face := floor(v_eligible * v_coupon.value / 100);
  else v_face := v_coupon.value; end if;
  v_discount := least(v_face, v_eligible, v_item_total);
  -- Mirrors _place_order_core: only a non-guaranteed coupon is capped.
  if not coalesce(v_coupon.guaranteed, false) then
    v_discount := least(v_discount, greatest(0, floor(v_item_margin)));
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_coupon.code,
    'discount', v_discount,          -- what this cart actually gets
    'faceValue', v_face,             -- the "up to" figure
    'guaranteed', coalesce(v_coupon.guaranteed, false),
    'capped', v_discount < v_face    -- true when the cart's margin limited it
  );
end;
$function$
;CREATE OR REPLACE FUNCTION public._place_order_core(p_uid uuid, p_items jsonb, p_coupon text DEFAULT NULL::text, p_location jsonb DEFAULT NULL::jsonb, p_payment text DEFAULT 'upi'::text, p_address text DEFAULT NULL::text, p_wallet numeric DEFAULT 0, p_redeem_points integer DEFAULT 0, p_membership boolean DEFAULT false, p_enforce_store_open boolean DEFAULT true, p_device text DEFAULT NULL::text)
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