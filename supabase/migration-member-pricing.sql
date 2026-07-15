-- ════════════════════════════════════════════════════════════════════════════
-- NGS Prime member pricing — two invisible modes, reshuffled every reprice cycle.
--
--   Mode A (charge a little MORE): member pays base × factor (factor > 1, clamped
--          to MRP). 60% of the extra is returned to the member as a reward
--          (points OR wallet, chosen at random per product), 40% stays with us —
--          this + the ₹99 fee fund the free delivery + no handling for members.
--   Mode B (charge a little LESS): member pays base × factor (factor < 1), with
--          the SAME reward a non-member would get.
--
-- The member never sees the non-member price, so neither mode is detectable — it
-- just reads as "good prices + good rewards". Nothing is given from our pocket.
--
-- Consistency: the charged unit price is  min(round(baseUnit × factor), MRP)  —
-- built only from public fields (price, mrp, member_factor), so the client shows
-- exactly what the server charges. It's always ≥ cost because every base unit
-- price (incl. bulk tiers) is already floored above cost and factor ≥ 0.97.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists member_factor     numeric not null default 1.0;
alter table public.products add column if not exists member_bonus_kind  text;   -- 'points' | 'wallet' | null

alter table public.orders   add column if not exists member_bonus_points  int     not null default 0;
alter table public.orders   add column if not exists member_bonus_wallet  numeric not null default 0;

-- Owner-tunable member-pricing config. markupPct = Mode-A ceiling, dipMax = Mode-B
-- floor, modeASharePct = how often Mode A fires, rewardBackPct = % of the Mode-A
-- extra handed back to the member.
update public.settings
   set rewards = coalesce(rewards,'{}'::jsonb) || jsonb_build_object(
     'member', coalesce(rewards->'member', jsonb_build_object(
        'enabled', true, 'markupPct', 6, 'dipMax', 3, 'modeASharePct', 55, 'rewardBackPct', 60)))
 where id = 1;

-- Members pay the surge/rain fee like everyone. Set it to ₹25.
update public.ops_config set surge_fee = 25 where id = 1;

-- ── smart_reprice(): assign each product a member factor + reward channel ─────
create or replace function public.smart_reprice()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  cfg     public.pricing_config;
  v_mem   jsonb;
  v_markup numeric; v_dip numeric; v_a_share numeric;
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

  -- ── Member pricing: reshuffle each product's mode/factor/reward channel ─────
  v_mem     := coalesce((select rewards->'member' from public.settings where id = 1), '{}'::jsonb);
  v_markup  := coalesce((v_mem->>'markupPct')::numeric, 6);
  v_dip     := coalesce((v_mem->>'dipMax')::numeric, 3);
  v_a_share := coalesce((v_mem->>'modeASharePct')::numeric, 55);

  -- Non-eligible (unpriced) products → neutral (members pay the same base price).
  update public.products p set member_factor = 1.0, member_bonus_kind = null
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced')
      and (p.member_factor <> 1.0 or p.member_bonus_kind is not null);

  if coalesce((v_mem->>'enabled')::boolean, true) then
    with elig as (
      select p.id,
        (random() < v_a_share / 100.0) as mode_a,
        random() as r1, random() as r2, random() as r3
      from public.products p
      join public.product_costs pc on pc.product_id = p.id
      where pc.cost is not null and pc.speed_tier <> 'unpriced'
    )
    update public.products p set
      member_factor = case when e.mode_a
                           then 1 + (v_markup * (0.5 + e.r1 * 0.5)) / 100    -- +~3% … +6%
                           else 1 - (v_dip * e.r2) / 100 end,                -- −0% … −3%
      member_bonus_kind = case when e.mode_a
                               then (case when e.r3 < 0.5 then 'points' else 'wallet' end)
                               else null end
    from elig e where p.id = e.id;
  else
    update public.products set member_factor = 1.0, member_bonus_kind = null
      where member_factor <> 1.0 or member_bonus_kind is not null;
  end if;
end; $function$;

-- ── place_order(): charge member pricing, accrue the Mode-A bonus, no handling ─
create or replace function public.place_order(p_items jsonb, p_coupon text default null, p_location jsonb default null, p_payment text default 'upi', p_address text default null, p_wallet numeric default 0, p_redeem_points integer default 0, p_membership boolean default false)
 returns public.orders language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_profile      public.profiles;
  v_settings     public.settings;
  v_line         jsonb;
  v_prod         public.products;
  v_qty          integer;
  v_unit         numeric;
  v_base         numeric;
  v_cost         numeric;
  v_item_total   numeric := 0;
  v_qualify_total numeric := 0;
  v_reward_margin numeric := 0;
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
  v_is_member    boolean;                 -- Prime member pricing
  v_mem_on       boolean := false;
  v_back_pct     numeric := 60;
  v_markup       numeric;
  v_bonus_pts    integer := 0;
  v_bonus_wallet numeric := 0;
begin
  if v_uid is null then raise exception 'You must be signed in to place an order.'; end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'Profile not found.'; end if;

  select * into v_settings from public.settings where id = 1;
  if not v_settings.store_open then raise exception 'The store is currently closed.'; end if;

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
  v_cfg_mem   := coalesce(v_rewards->'member', '{}'::jsonb);
  v_mem_on    := v_is_member and coalesce((v_cfg_mem->>'enabled')::boolean, true);
  v_back_pct  := coalesce((v_cfg_mem->>'rewardBackPct')::numeric, 60);

  -- NGS Prime add-on: only for a non-member, when membership is enabled.
  if coalesce(p_membership, false) then
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

    v_base := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_unit := v_base;
    -- Member pricing: apply the per-product factor, clamped to MRP.
    if v_mem_on and coalesce(v_prod.member_factor, 1) <> 1 then
      v_unit := least(round(v_base * v_prod.member_factor), coalesce(v_prod.mrp, v_base * v_prod.member_factor));
      -- Mode A (paid a little more) → 60% of the extra back as points or wallet.
      if v_unit > v_base then
        v_markup := (v_unit - v_base) * v_qty;
        if v_prod.member_bonus_kind = 'wallet' then
          v_bonus_wallet := v_bonus_wallet + floor(v_markup * v_back_pct / 100);
        else
          v_bonus_pts := v_bonus_pts + (floor(v_markup * v_back_pct / 100) * v_redeem_per)::int;
        end if;
      end if;
    end if;

    v_item_total := v_item_total + v_unit * v_qty;
    if not coalesce(v_prod.free_delivery_exempt, false) then
      v_qualify_total := v_qualify_total + v_unit * v_qty;
    end if;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
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

  v_points_total   := floor(greatest(v_reward_margin, 0) * v_margin_ppr);
  v_scratch_points := round(v_points_total * greatest(v_pts_share, 0) / 100);
  v_points         := greatest(v_points_total - v_scratch_points, 0);
  v_scratch_wallet := least(round(greatest(v_high_margin, 0) * greatest(v_wallet_cut, 0) / 100), v_wallet_max);
  if coalesce((v_scratch->>'enabled')::boolean, true) = false
     or v_item_total < coalesce((v_scratch->>'minOrder')::numeric, 0) then
    v_points := v_points_total; v_scratch_points := 0; v_scratch_wallet := 0;
  end if;

  -- Members: no handling charge (funded by the Mode-A margin + the ₹99 fee).
  v_handling := case when v_is_member then 0 else v_settings.handling_fee end;
  if v_qualify_total >= v_settings.free_delivery_above then v_delivery := 0;
  elsif v_profile.is_member then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  v_total := v_item_total - v_discount - v_redeem_rupees + v_delivery + v_handling + v_surge + v_member_fee;

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
    membership_fee, membership_days, member_bonus_points, member_bonus_wallet
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location, v_scratch_points, v_scratch_wallet,
    v_member_fee, case when v_add_member then v_member_days else null end,
    v_bonus_pts, v_bonus_wallet
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
    v_base := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_unit := v_base;
    if v_mem_on and coalesce(v_prod.member_factor, 1) <> 1 then
      v_unit := least(round(v_base * v_prod.member_factor), coalesce(v_prod.mrp, v_base * v_prod.member_factor));
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

  -- Prime Mode-A bonus (self-funded from the member's own surcharge). Award now
  -- for immediate orders; online orders award at payment confirmation.
  if not v_online and v_bonus_pts > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_bonus_pts, 'Prime bonus on ' || v_code);
    update public.profiles set points = points + v_bonus_pts where id = v_uid;
  end if;
  if not v_online and v_bonus_wallet > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, v_bonus_wallet, 'reward', 'Prime bonus on ' || v_code, v_order.id, v_uid);
  end if;

  if not v_online and v_add_member then
    perform public._activate_membership(v_uid, v_member_days);
  end if;

  return v_order;
end;
$function$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean) to authenticated;

-- ── mark_order_paid(): award the Prime bonus for online orders at confirmation ─
create or replace function public.mark_order_paid(p_order uuid, p_payment_id text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order public.orders;
  v_line  record;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if v_order.payment_status = 'paid' then return; end if;
  if v_order.status = 'Cancelled' then return; end if;

  if coalesce(v_order.is_membership, false) then
    perform public._activate_membership(v_order.user_id, coalesce(v_order.membership_days, 30));
    update public.orders set payment_status = 'paid', status = 'Membership',
      razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id) where id = p_order;
    return;
  end if;

  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'Awaiting payment' then 'Placed' else status end,
    razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
  where id = p_order;

  for v_line in select product_id, qty from public.order_items where order_id = p_order loop
    update public.products set stock = greatest(0, stock - v_line.qty)
      where id = v_line.product_id and stock is not null;
  end loop;

  if coalesce(v_order.wallet_used, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'spent') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, -v_order.wallet_used, 'spent', 'Used on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.points_redeemed, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Redeemed on%') then
    update public.profiles set points = greatest(0, points - v_order.points_redeemed) where id = v_order.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, -v_order.points_redeemed, 'Redeemed on ' || v_order.human_code);
  end if;

  if v_order.points_earned > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Earned%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.points_earned, 'Earned on ' || v_order.human_code);
    update public.profiles set points = points + v_order.points_earned where id = v_order.user_id;
  end if;

  -- Prime Mode-A bonus (self-funded), awarded once at confirmation.
  if coalesce(v_order.member_bonus_points, 0) > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order and reason like 'Prime bonus%') then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.member_bonus_points, 'Prime bonus on ' || v_order.human_code);
    update public.profiles set points = points + v_order.member_bonus_points where id = v_order.user_id;
  end if;
  if coalesce(v_order.member_bonus_wallet, 0) > 0
     and not exists (select 1 from public.customer_wallet where order_id = p_order and kind = 'reward' and note like 'Prime bonus%') then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_order.user_id, v_order.member_bonus_wallet, 'reward', 'Prime bonus on ' || v_order.human_code, p_order, v_order.user_id);
  end if;

  if coalesce(v_order.membership_days, 0) > 0 then
    perform public._activate_membership(v_order.user_id, v_order.membership_days);
  end if;
end;
$function$;

-- Populate member factors immediately.
select public.smart_reprice();
