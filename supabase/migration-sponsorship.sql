-- Brand sponsorship — funds fulfilment, never a product discount.
--
-- The shop's rule is absolute: no product is ever sold below cost, and no brand
-- money is ever converted into a price cut. What sponsorship CAN pay for is the
-- cost of getting the order to the door — the delivery fee the customer would
-- otherwise pay.
--
-- Why this is worth building at NGS's size. Measured on 52 delivered orders,
-- only 44% pay a delivery fee at all (the rest clear the free-delivery bar), so
-- the whole delivery fee line is about Rs495 a month. A single Rs500/month brand
-- deal therefore buys free delivery on EVERY order that currently pays — the
-- same headline Zepto uses, funded by a distributor rather than out of a 12.2%
-- product margin.
--
-- Design constraints this has to satisfy:
--   * Never touches product price. Margin logic is untouched.
--   * Self-limiting. A fund can only ever spend what was actually paid in.
--   * Race-safe. Two concurrent orders cannot overdraw the same fund.
--   * Auditable. Every rupee drawn is a ledger row tied to an order.
--   * Honest to the customer. The brand is named on the bill, not hidden.

begin;

create table if not exists public.sponsorships (
  id          uuid primary key default gen_random_uuid(),
  brand       text        not null,
  purpose     text        not null default 'delivery',
  amount      numeric     not null,
  spent       numeric     not null default 0,
  starts_on   date        not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on     date,
  active      boolean     not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  constraint sponsorships_sane check (
    length(btrim(brand)) between 1 and 60
    and purpose in ('delivery')
    and amount > 0 and amount <= 1000000
    and spent >= 0
    and (ends_on is null or ends_on >= starts_on)
  )
);

-- Every draw is recorded against the order that used it, so the shop can prove
-- to the brand exactly what their money bought.
create table if not exists public.sponsorship_ledger (
  id              uuid primary key default gen_random_uuid(),
  sponsorship_id  uuid not null references public.sponsorships(id) on delete cascade,
  order_id        uuid references public.orders(id) on delete set null,
  amount          numeric not null,
  created_at      timestamptz not null default now()
);
create index if not exists sponsorship_ledger_sponsor_idx on public.sponsorship_ledger(sponsorship_id, created_at desc);

-- Both tables are shop-internal. RLS on, no permissive policy, privileges
-- revoked: reachable only through the SECURITY DEFINER functions below.
alter table public.sponsorships       enable row level security;
alter table public.sponsorship_ledger enable row level security;
revoke all on public.sponsorships       from anon, authenticated;
revoke all on public.sponsorship_ledger from anon, authenticated;

-- What the customer app is allowed to know: whether delivery is sponsored right
-- now, and by whom. No amounts, no balances, no commercial terms.
alter table public.orders
  add column if not exists sponsored_delivery_by text,
  add column if not exists sponsored_amount      numeric not null default 0;

-- ── Draw from the fund ─────────────────────────────────────────────────────
-- Returns the brand name if the draw succeeded, NULL if no fund could cover it.
-- The UPDATE ... WHERE amount - spent >= p_amount is the whole race guard: two
-- concurrent orders serialise on the row, and the second one simply misses.
create or replace function public._sponsor_draw(p_amount numeric, p_order uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_brand text; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;

  update public.sponsorships s
     set spent = s.spent + p_amount
   where s.id = (
     select s2.id from public.sponsorships s2
      where s2.active
        and s2.purpose = 'delivery'
        and s2.starts_on <= v_today
        and (s2.ends_on is null or s2.ends_on >= v_today)
        and s2.amount - s2.spent >= p_amount
      order by s2.ends_on nulls last, s2.created_at   -- spend the soonest-expiring fund first
      limit 1
      for update skip locked
   )
  returning s.id, s.brand into v_id, v_brand;

  if v_id is null then return null; end if;

  insert into public.sponsorship_ledger (sponsorship_id, order_id, amount)
  values (v_id, p_order, p_amount);

  return v_brand;
end;
$$;

revoke all on function public._sponsor_draw(numeric, uuid) from public, anon, authenticated;

-- ── Is delivery sponsored right now? ───────────────────────────────────────
-- Cheap, safe read for the cart so the bill preview matches what checkout will
-- charge. Publishes only the brand name and nothing about the money.
create or replace function public.sponsored_delivery_now(p_fee numeric default 0)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.brand from public.sponsorships s
   where s.active and s.purpose = 'delivery'
     and s.starts_on <= (now() at time zone 'Asia/Kolkata')::date
     and (s.ends_on is null or s.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
     and s.amount - s.spent >= greatest(coalesce(p_fee, 0), 0)
   order by s.ends_on nulls last, s.created_at
   limit 1;
$$;

revoke all on function public.sponsored_delivery_now(numeric) from public;
grant execute on function public.sponsored_delivery_now(numeric) to anon, authenticated;

-- ── Admin ──────────────────────────────────────────────────────────────────
create or replace function public.admin_save_sponsorship(
  p_id uuid, p_brand text, p_amount numeric, p_starts date, p_ends date, p_active boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if length(btrim(coalesce(p_brand,''))) = 0 then raise exception 'Brand name is required.'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be more than zero.'; end if;

  if p_id is null then
    insert into public.sponsorships (brand, amount, starts_on, ends_on, active, note)
    values (btrim(p_brand), p_amount,
            coalesce(p_starts, (now() at time zone 'Asia/Kolkata')::date), p_ends,
            coalesce(p_active, true), nullif(btrim(coalesce(p_note,'')), ''))
    returning id into v_id;
  else
    update public.sponsorships set
      brand = btrim(p_brand), amount = p_amount,
      starts_on = coalesce(p_starts, starts_on), ends_on = p_ends,
      active = coalesce(p_active, true), note = nullif(btrim(coalesce(p_note,'')), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Sponsorship not found.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_list_sponsorships()
returns table(id uuid, brand text, amount numeric, spent numeric, remaining numeric,
              starts_on date, ends_on date, active boolean, note text,
              deliveries int, last_used timestamptz)
language sql
security definer
set search_path to 'public'
as $$
  select s.id, s.brand, s.amount, s.spent, s.amount - s.spent,
         s.starts_on, s.ends_on, s.active, s.note,
         (select count(*)::int from public.sponsorship_ledger l where l.sponsorship_id = s.id),
         (select max(l.created_at) from public.sponsorship_ledger l where l.sponsorship_id = s.id)
    from public.sponsorships s
   where public.is_admin()
   order by s.active desc, s.created_at desc;
$$;

revoke all on function public.admin_save_sponsorship(uuid, text, numeric, date, date, boolean, text) from public, anon;
revoke all on function public.admin_list_sponsorships() from public, anon;
grant execute on function public.admin_save_sponsorship(uuid, text, numeric, date, date, boolean, text) to authenticated;
grant execute on function public.admin_list_sponsorships() to authenticated;

commit;

-- ── Final deployed forms ───────────────────────────────────────────────────
-- _sponsor_draw returns a ledger handle rather than taking an order id, because
-- the waiver must be decided BEFORE the order row exists (it changes the total),
-- and the ledger row is linked to the order immediately after the insert.
CREATE OR REPLACE FUNCTION public._sponsor_draw(p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_brand text; v_ledger uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;

  -- The WHERE amount - spent >= p_amount inside the subselect, combined with
  -- FOR UPDATE SKIP LOCKED, is the whole race guard: two concurrent orders
  -- serialise on the row and the second simply finds no fund with room.
  update public.sponsorships s
     set spent = s.spent + p_amount
   where s.id = (
     select s2.id from public.sponsorships s2
      where s2.active and s2.purpose = 'delivery'
        and s2.starts_on <= v_today
        and (s2.ends_on is null or s2.ends_on >= v_today)
        and s2.amount - s2.spent >= p_amount
      order by s2.ends_on nulls last, s2.created_at
      limit 1
      for update skip locked
   )
  returning s.id, s.brand into v_id, v_brand;

  if v_id is null then return null; end if;

  insert into public.sponsorship_ledger (sponsorship_id, amount)
  values (v_id, p_amount) returning id into v_ledger;

  return jsonb_build_object('brand', v_brand, 'ledgerId', v_ledger);
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
  v_sponsor      jsonb;
  v_sponsor_by   text;
  v_sponsor_amt  numeric := 0;
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
    member_savings, sponsored_delivery_by, sponsored_amount
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_small_cart, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
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