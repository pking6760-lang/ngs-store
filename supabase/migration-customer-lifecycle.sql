-- ════════════════════════════════════════════════════════════════════════════
-- Customer ID + new-customer "honeymoon" that quietly cools off.
--
-- Every customer gets a permanent Customer ID (NGS10042…). Their first orders
-- get boosted rewards + a welcome discount; over the next stretch of orders it
-- tapers — a little each order, too small to notice — down to a permanent floor
-- that never hits zero (points & wallet keep coming, just at a normal rate).
-- The discount is the real margin cost, so it fades fastest; points/wallet keep
-- the lasting floor. Prime members get a higher curve than non-members at every
-- step. Everything is admin-tunable via settings.rewards.lifecycle.
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.customer_code_seq start 10001;

alter table public.profiles add column if not exists customer_code text unique;
alter table public.profiles add column if not exists order_count   int not null default 0;
alter table public.orders   add column if not exists welcome_discount numeric not null default 0;

-- Backfill existing customers with a Customer ID + their confirmed-order count.
update public.profiles p set customer_code = 'NGS' || nextval('public.customer_code_seq')
 where customer_code is null;
update public.profiles p set order_count = c.n
  from (select user_id, count(*) n from public.orders
        where status not in ('Awaiting payment','Cancelled')
          and coalesce(is_return,false) = false and coalesce(is_membership,false) = false
        group by user_id) c
 where p.id = c.user_id and p.order_count = 0;

-- New profiles get a Customer ID automatically.
create or replace function public.assign_customer_code()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.customer_code is null then
    NEW.customer_code := 'NGS' || nextval('public.customer_code_seq');
  end if;
  return NEW;
end $function$;
drop trigger if exists trg_assign_customer_code on public.profiles;
create trigger trg_assign_customer_code before insert on public.profiles
  for each row execute function public.assign_customer_code();

-- Default lifecycle config (admin-tunable). Prime is always ahead of non-member.
update public.settings
   set rewards = coalesce(rewards,'{}'::jsonb) || jsonb_build_object(
     'lifecycle', coalesce(rewards->'lifecycle', jsonb_build_object(
        'enabled', true,
        'welcomeOrders', 5,
        'taperOrders', 15,
        'member',    jsonb_build_object('pointsBoost',2.0,'pointsFloor',1.3,'discPct',10,'discFloorPct',2,'discMax',50),
        'nonmember', jsonb_build_object('pointsBoost',1.5,'pointsFloor',1.0,'discPct',6, 'discFloorPct',0,'discMax',30))))
 where id = 1;

-- ── place_order(): apply the lifecycle boost + welcome discount, track count ──
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
  v_is_member    boolean;
  v_mem_on       boolean := false;
  v_back_pct     numeric := 60;
  v_markup       numeric;
  v_bonus_pts    integer := 0;
  v_bonus_wallet numeric := 0;
  -- Lifecycle (new-customer boost that tapers to a floor)
  v_life         jsonb;
  v_life_on      boolean := false;
  v_tier         jsonb;
  v_n            int;
  v_welcome_ord  int;
  v_taper_ord    int;
  v_boost        numeric := 1;
  v_floor        numeric := 1;
  v_disc_pct     numeric := 0;
  v_disc_floor   numeric := 0;
  v_disc_max     numeric := 0;
  v_frac         numeric := 1;
  v_mult         numeric := 1;
  v_disc_now     numeric := 0;
  v_welcome_disc numeric := 0;
begin
  if v_uid is null then raise exception 'You must be signed in to place an order.'; end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'Profile not found.'; end if;

  -- Ensure a Customer ID exists (safety net; the insert trigger handles new rows).
  if v_profile.customer_code is null then
    update public.profiles set customer_code = 'NGS' || nextval('public.customer_code_seq')
      where id = v_uid and customer_code is null;
  end if;

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

  -- Lifecycle factors for THIS order (their v_n-th). Member vs non-member curve.
  v_n      := coalesce(v_profile.order_count, 0) + 1;
  v_life   := coalesce(v_rewards->'lifecycle', '{}'::jsonb);
  v_life_on := coalesce((v_life->>'enabled')::boolean, true);
  if v_life_on then
    v_welcome_ord := coalesce((v_life->>'welcomeOrders')::int, 5);
    v_taper_ord   := greatest(coalesce((v_life->>'taperOrders')::int, 15), 1);
    v_tier := coalesce(v_life->(case when v_is_member then 'member' else 'nonmember' end), '{}'::jsonb);
    v_boost      := coalesce((v_tier->>'pointsBoost')::numeric, case when v_is_member then 2.0 else 1.5 end);
    v_floor      := coalesce((v_tier->>'pointsFloor')::numeric, case when v_is_member then 1.3 else 1.0 end);
    v_disc_pct   := coalesce((v_tier->>'discPct')::numeric, case when v_is_member then 10 else 6 end);
    v_disc_floor := coalesce((v_tier->>'discFloorPct')::numeric, case when v_is_member then 2 else 0 end);
    v_disc_max   := coalesce((v_tier->>'discMax')::numeric, case when v_is_member then 50 else 30 end);
    if v_n <= v_welcome_ord then v_frac := 0;
    elsif v_n <= v_welcome_ord + v_taper_ord then v_frac := (v_n - v_welcome_ord)::numeric / v_taper_ord;
    else v_frac := 1; end if;
    v_mult     := v_boost - (v_boost - v_floor) * v_frac;
    v_disc_now := v_disc_pct - (v_disc_pct - v_disc_floor) * v_frac;
  end if;

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
    if v_mem_on and coalesce(v_prod.member_factor, 1) <> 1 then
      v_unit := least(round(v_base * v_prod.member_factor), coalesce(v_prod.mrp, v_base * v_prod.member_factor));
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

  -- Welcome discount (tapers with order count), capped in ₹ and by what's left.
  if v_life_on and v_item_total > 0 and v_disc_now > 0 then
    v_welcome_disc := least(round(v_item_total * v_disc_now / 100), v_disc_max);
    v_welcome_disc := greatest(least(v_welcome_disc, v_item_total - v_discount - v_redeem_rupees), 0);
  end if;

  -- Points + wallet earned, boosted by the lifecycle multiplier.
  v_points_total   := floor(greatest(v_reward_margin, 0) * v_margin_ppr * v_mult);
  v_scratch_points := round(v_points_total * greatest(v_pts_share, 0) / 100);
  v_points         := greatest(v_points_total - v_scratch_points, 0);
  v_scratch_wallet := least(round(greatest(v_high_margin, 0) * greatest(v_wallet_cut, 0) / 100 * v_mult),
                            round(v_wallet_max * v_mult));
  if coalesce((v_scratch->>'enabled')::boolean, true) = false
     or v_item_total < coalesce((v_scratch->>'minOrder')::numeric, 0) then
    v_points := v_points_total; v_scratch_points := 0; v_scratch_wallet := 0;
  end if;

  v_handling := case when v_is_member then 0 else v_settings.handling_fee end;
  if v_qualify_total >= v_settings.free_delivery_above then v_delivery := 0;
  elsif v_profile.is_member then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  v_total := v_item_total - v_discount - v_redeem_rupees - v_welcome_disc
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
    v_bonus_pts, v_bonus_wallet, v_welcome_disc
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

  -- Count this order toward the customer's lifecycle (immediate orders now;
  -- online orders count at payment confirmation, so an abandoned one doesn't).
  if not v_online then
    update public.profiles set order_count = coalesce(order_count, 0) + 1 where id = v_uid;
  end if;

  return v_order;
end;
$function$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean) to authenticated;

-- ── mark_order_paid(): count online orders toward the lifecycle at confirmation ─
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

  -- Count this confirmed online order toward the customer's lifecycle.
  if not coalesce(v_order.is_return, false) then
    update public.profiles set order_count = coalesce(order_count, 0) + 1 where id = v_order.user_id;
  end if;
end;
$function$;
