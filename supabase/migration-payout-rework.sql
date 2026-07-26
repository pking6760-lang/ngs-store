-- Payout rework — every number derived, none guessed.
--
-- Full reasoning is in the costing note shared with the owner (Delhi minimum
-- wage Rs 84.1/hr, petrol Rs 102.12/L, ~Rs 2/km running cost, Blinkit's public
-- rider rate card). Four decisions were the owner's to make; since NGS is
-- pre-launch and the owner asked me to decide, I made the conservative,
-- competitive call on each and this migration implements it:
--
--   1. Target rider pay: ~Rs 107/hour net of fuel, matching market rate.
--   2. The 3km edge-of-radius loss: a second, higher free-delivery threshold
--      beyond 1.5 km, applied to EVERYONE including Prime (a small Prime order
--      that far out costs more to deliver than it earns — see finding #3).
--   3. Prime riders no longer paid less for identical work. Deleted outright.
--   4. Slot guarantee: built, wired, and left OFF. At 5.6 orders/day it would
--      cost far more than it earns (needs ~6.2 orders/hour to break even —
--      the busiest hour measured was 0.7). Turn on once volume supports it.

begin;

-- ── 1. Config: repurpose the existing rider/picker columns to the derived
--    formula, drop the two that funded the Prime/free-km discrimination,
--    add the far-zone delivery threshold, and add (disabled) slot guarantee.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.ops_config
  add column if not exists rider_min              numeric not null default 18,
  add column if not exists picker_per_line         numeric not null default 1.5,
  add column if not exists picker_per_unit         numeric not null default 0.25,
  add column if not exists free_delivery_far_above numeric not null default 399,
  add column if not exists far_zone_km             numeric not null default 1.5,
  add column if not exists slot_guarantee_enabled  boolean not null default false,
  add column if not exists rider_floor_hourly      numeric not null default 100,
  add column if not exists picker_floor_hourly     numeric not null default 85,
  add column if not exists slot_length_hours       numeric not null default 2;

-- rider_base: was the flat delivery base (Rs 22 guest / Rs 16 member) — now the
--   fixed component of the solved formula (Rs 7). rider_per_km: was Rs 5/km
--   beyond 2 free km — now Rs 16/km from the first metre. picker_pack_fee: was
--   a flat Rs 8 regardless of size — now the fixed component of the picking
--   formula (Rs 3); picker_per_line/picker_per_unit carry the rest.
update public.ops_config set
  rider_base       = 7,
  rider_per_km     = 16,
  rider_min        = 18,
  rider_free_km    = 0,      -- no longer read; zeroed so nothing stale lingers
  picker_pack_fee  = 3,
  picker_per_line  = 1.5,
  picker_per_unit  = 0.25
where id = 1;

alter table public.ops_config drop column if exists rider_member_base;

alter table public.ops_config
  drop constraint if exists ops_config_payout_sane;
alter table public.ops_config
  add constraint ops_config_payout_sane check (
    rider_base >= 0 and rider_base <= 200
    and rider_per_km >= 0 and rider_per_km <= 100
    and rider_min >= 0 and rider_min <= 300
    and picker_pack_fee >= 0 and picker_pack_fee <= 200
    and picker_per_line >= 0 and picker_per_line <= 50
    and picker_per_unit >= 0 and picker_per_unit <= 20
    and free_delivery_far_above >= 0 and free_delivery_far_above <= 10000
    and far_zone_km >= 0 and far_zone_km <= 20
    and rider_floor_hourly >= 0 and rider_floor_hourly <= 1000
    and picker_floor_hourly >= 0 and picker_floor_hourly <= 1000
    and slot_length_hours > 0 and slot_length_hours <= 12
  );

commit;

-- ── 2. Picking payout: base + per line + per unit ──────────────────────────
CREATE OR REPLACE FUNCTION public.partner_mark_packed(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.ops_config; v_earn numeric; v_pid uuid; v_upd int;
        v_lines int; v_units numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select picker_id into v_pid from public.orders where id = p_order;
  if not (public.is_admin() or (v_pid is not null and v_pid = auth.uid())) then raise exception 'Not your order to pack.'; end if;
  -- Picking pay = base + per line + per unit. Lines/units are the same counts
  -- the order was placed with — a 1-item order and a 12-item order no longer
  -- pay the same flat fee for very different amounts of work.
  select count(*), coalesce(sum(qty), 0) into v_lines, v_units
    from public.order_items where order_id = p_order;
  v_earn := round(coalesce(cfg.picker_pack_fee, 0)
                 + coalesce(v_lines, 0) * coalesce(cfg.picker_per_line, 0)
                 + coalesce(v_units, 0) * coalesce(cfg.picker_per_unit, 0), 2);
  update public.orders
     set picker_state = 'packed', packed_at = now(), status = 'Packed'
   where id = p_order and picker_state <> 'packed';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then return; end if;
  insert into public.order_economics (order_id, picker_earning)
    values (p_order, case when v_pid is not null then v_earn else 0 end)
    on conflict (order_id) do update set picker_earning = excluded.picker_earning, updated_at = now();
  if v_pid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
    values (v_pid, p_order, 'earning', v_earn, 'Packing', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_pid and active_order_id = p_order;
  end if;
end; $function$

-- ── 3. Delivery payout: base + per km, floored, no membership discount ─────
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
    -- Rider pay = base + per km, from the first metre, floored at a per-order
    -- minimum. Deliberately blind to whether the customer is a Prime member —
    -- the ride is identical work either way, so it is paid identically. Prime
    -- is a discount the SHOP chooses to give the customer; it is funded out of
    -- item margin, never out of the rider's pay.
    v_earn := round(
        greatest(coalesce(cfg.rider_base, 0) + coalesce(v_dist, 0) * coalesce(cfg.rider_per_km, 0),
                 coalesce(cfg.rider_min, 0))
      + case when coalesce(cfg.surge_on, false) then coalesce(cfg.peak_bonus, 0) else 0 end, 2);
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

-- ── 4. Settings mirror: far-zone columns + sync trigger ────────────────────
alter table public.settings
  add column if not exists far_zone_km             numeric not null default 1.5,
  add column if not exists free_delivery_far_above  numeric not null default 399;

update public.settings s set
  far_zone_km             = o.far_zone_km,
  free_delivery_far_above = o.free_delivery_far_above
from public.ops_config o where s.id = 1 and o.id = 1;


CREATE OR REPLACE FUNCTION public.sync_ops_to_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.settings set
    handling_fee            = new.handling_fee,
    delivery_fee             = new.delivery_fee,
    free_delivery_above      = new.free_delivery_threshold,
    surge_fee                = new.surge_fee,
    cod_customer_limit       = new.cod_customer_limit,
    small_cart_fee            = new.small_cart_fee,
    small_cart_threshold      = new.small_cart_threshold,
    far_zone_km               = new.far_zone_km,
    free_delivery_far_above   = new.free_delivery_far_above
  where id = 1;
  return new;
end;
$function$
;
-- ── 5. _place_order_core: distance-banded free delivery (far zone applies to
--    Prime too), line/unit counting for the shop-facing profit estimate, and
--    the same rider/picker formula as sections 2–3 used for that estimate.
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
    if not coalesce(v_prod.free_delivery_exempt, false) then
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
  -- thin-margin items (milk & dairy, flagged free_delivery_exempt) there is no
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
  v_far := coalesce((p_location->>'distanceKm')::numeric, 0) >= coalesce(v_ops.far_zone_km, 999);
  v_free_thresh := case when v_far then coalesce(v_ops.free_delivery_far_above, v_settings.free_delivery_above)
                        else v_settings.free_delivery_above end;
  v_free_perk := v_is_member and not v_far
                 and (not v_has_thin or v_qualify_total >= v_settings.free_delivery_above);
  -- Handling is charged to EVERYONE — Prime's perk is free delivery only.
  v_handling := v_settings.handling_fee;
  if v_qualify_total >= v_free_thresh then v_delivery := 0;
  elsif v_free_perk then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
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
-- ── 6. slot_sweep(): guarantee top-up, gated on ops_config.slot_guarantee_enabled
--    (default false — see the costing note: current order volume is far below
--    what a guarantee needs to break even). Idempotent: the top-up only runs
--    the instant a slot leaves 'booked' status, so re-running the sweep (it
--    fires every 5 minutes) can never double-pay it.
CREATE OR REPLACE FUNCTION public.slot_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; cfg public.ops_config; v_start timestamptz; v_end timestamptz; v_online boolean; v_jobs int;
        v_earned numeric; v_floor_hourly numeric; v_target numeric; v_topup numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  for s in select * from public.partner_slots where status = 'booked' loop
    v_start := (s.slot_date::text || ' ' || lpad(s.start_hour::text, 2, '0') || ':00:00')::timestamp at time zone 'Asia/Kolkata';
    v_end := v_start + (coalesce(cfg.slot_length_hours, 2) * interval '1 hour');
    if now() < v_end then continue; end if;
    select exists(select 1 from public.partner_online_log l where l.user_id = s.partner_id
       and l.started_at < v_end and coalesce(l.ended_at, now()) > v_start) into v_online;
    select count(*) into v_jobs from public.orders o
      where (o.rider_id = s.partner_id and o.delivered_at between v_start and v_end)
         or (o.picker_id = s.partner_id and o.packed_at between v_start and v_end);
    if v_online or v_jobs > 0 then
      update public.partner_slots set status = 'fulfilled', fulfilled_at = now() where id = s.id;
      -- Slot guarantee: a rider/picker who showed up and worked the slot but had
      -- a quiet stretch is topped up to an hourly floor. Off by default — see
      -- ops_config.slot_guarantee_enabled. Idempotent: this only runs once per
      -- slot, the moment it leaves 'booked' status above, so re-running the
      -- sweep can never double-pay it.
      if coalesce(cfg.slot_guarantee_enabled, false) then
        select coalesce(sum(amount), 0) into v_earned from public.wallet_ledger
         where partner_id = s.partner_id and kind = 'earning' and created_at between v_start and v_end;
        v_floor_hourly := case when s.role = 'picker' then coalesce(cfg.picker_floor_hourly, 0)
                                else coalesce(cfg.rider_floor_hourly, 0) end;
        v_target := round(v_floor_hourly * coalesce(cfg.slot_length_hours, 2), 2);
        v_topup := greatest(v_target - v_earned, 0);
        if v_topup > 0 then
          insert into public.wallet_ledger (partner_id, kind, amount, note, created_by)
          values (s.partner_id, 'earning', v_topup,
                  'Slot guarantee top-up (' || s.slot_date || ' ' || s.start_hour || ':00)', null);
        end if;
      end if;
    else
      update public.partner_slots set status = 'missed' where id = s.id;
      perform public.partner_penalize(s.partner_id, 'slot_no_show', null, s.id);
    end if;
  end loop;
end;
$function$
;