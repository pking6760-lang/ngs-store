-- ════════════════════════════════════════════════════════════════════════════
-- Margin-based reward points + server-enforced redemption.
--
-- EARN: points are given from the profit (margin) of an order, but ONLY on
--       items whose margin exceeds `pointsMinMarginPct` (default 12%) — thin-
--       margin staples (milk/curd/bread) earn nothing. Points earned =
--       round(eligible_margin × marginPointsPerRupee). Unknown-cost items are
--       ignored (never give points on unknown margin).
-- REDEEM: at checkout the customer can pay part of the order with points. It is
--       validated + capped SERVER-SIDE (≤ balance, ≤ maxRedeemPct% of the item
--       total, ≤ what's left after a coupon) and the points are debited in the
--       same transaction. Redeemed points are returned if the order is cancelled.
--
-- Config lives in settings.rewards:
--   marginPointsPerRupee (points per ₹1 of eligible margin, default 0.4)
--   pointsMinMarginPct   (min item margin % to earn, default 12)
--   maxRedeemPct         (max % of an order payable with points, default 20)
--   redeemPer            (points per ₹1 when redeeming, default 10)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists points_redeemed  integer     not null default 0;
alter table public.orders add column if not exists points_discount  numeric(10,2) not null default 0;
alter table public.orders add column if not exists points_restored  boolean     not null default false;

update public.settings
   set rewards = coalesce(rewards, '{}'::jsonb)
     || jsonb_build_object('marginPointsPerRupee', 0.4, 'pointsMinMarginPct', 12, 'maxRedeemPct', 20)
 where id = 1;

-- New signature adds p_redeem_points → drop the old 6-arg overload first.
drop function if exists public.place_order(jsonb, text, jsonb, text, text, numeric);

CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_coupon text DEFAULT NULL::text, p_location jsonb DEFAULT NULL::jsonb, p_payment text DEFAULT 'upi'::text, p_address text DEFAULT NULL::text, p_wallet numeric DEFAULT 0, p_redeem_points integer DEFAULT 0)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_profile      public.profiles;
  v_settings     public.settings;
  v_line         jsonb;
  v_prod         public.products;
  v_qty          integer;
  v_unit         numeric;
  v_cost         numeric;
  v_item_total   numeric := 0;
  v_qualify_total numeric := 0;
  v_reward_margin numeric := 0;   -- margin from >threshold items only
  v_cat_totals   jsonb := '{}';
  v_discount     numeric := 0;    -- coupon discount
  v_coupon       public.coupons;
  v_eligible     numeric;
  v_delivery     numeric := 0;
  v_handling     numeric := 0;
  v_surge        numeric := 0;
  v_total        numeric;
  v_wallet_bal   numeric := 0;
  v_wallet_use   numeric := 0;
  v_points       integer := 0;    -- points earned
  v_pts_bal      integer := 0;
  v_redeem_pts   integer := 0;    -- points consumed
  v_redeem_rupees numeric := 0;   -- ₹ discount from points
  v_rewards      jsonb;
  v_margin_ppr   numeric;
  v_min_margin_pct numeric;
  v_redeem_per   numeric;
  v_max_redeem_pct numeric;
  v_order        public.orders;
  v_code         text;
  v_online       boolean := lower(coalesce(p_payment, '')) in ('razorpay', 'online', 'card');
  v_status       text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'Profile not found.'; end if;

  select * into v_settings from public.settings where id = 1;
  if not v_settings.store_open then raise exception 'The store is currently closed.'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  v_rewards        := v_settings.rewards;
  v_margin_ppr     := coalesce((v_rewards->>'marginPointsPerRupee')::numeric, 0.4);
  v_min_margin_pct := coalesce((v_rewards->>'pointsMinMarginPct')::numeric, 12);
  v_redeem_per     := coalesce((v_rewards->>'redeemPer')::numeric, 10);
  v_max_redeem_pct := coalesce((v_rewards->>'maxRedeemPct')::numeric, 20);

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then raise exception 'Bad quantity in cart.'; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A product in your cart is no longer available.'; end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;
    v_unit := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_item_total := v_item_total + v_unit * v_qty;
    if not coalesce(v_prod.free_delivery_exempt, false) then
      v_qualify_total := v_qualify_total + v_unit * v_qty;
    end if;
    -- Reward margin: only items with margin% above the threshold contribute.
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null and v_unit > 0
       and ((v_unit - v_cost) / v_unit) * 100 > v_min_margin_pct then
      v_reward_margin := v_reward_margin + (v_unit - v_cost) * v_qty;
    end if;
    v_cat_totals := jsonb_set(v_cat_totals, array[coalesce(v_prod.category,'_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category,'_'))::numeric, 0) + v_unit * v_qty));
  end loop;

  -- Coupon (server-validated).
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

  -- Points redemption (₹ discount), validated + capped server-side.
  if coalesce(p_redeem_points, 0) > 0 and v_redeem_per > 0 then
    select points into v_pts_bal from public.profiles where id = v_uid;
    v_redeem_rupees := floor(least(p_redeem_points, greatest(coalesce(v_pts_bal, 0), 0)) / v_redeem_per);
    v_redeem_rupees := least(v_redeem_rupees, floor(v_item_total * v_max_redeem_pct / 100), v_item_total - v_discount);
    if v_redeem_rupees < 0 then v_redeem_rupees := 0; end if;
    v_redeem_pts := (v_redeem_rupees * v_redeem_per)::int;
  end if;

  -- Points earned from eligible margin.
  v_points := floor(greatest(v_reward_margin, 0) * v_margin_ppr);

  v_handling := v_settings.handling_fee;
  if v_qualify_total >= v_settings.free_delivery_above then v_delivery := 0;
  elsif v_profile.is_member then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  v_total := v_item_total - v_discount - v_redeem_rupees + v_delivery + v_handling + v_surge;

  -- NGS wallet credit (capped at balance & total).
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
    address, distance_km, location
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_redeem_pts, v_redeem_rupees, v_total, v_wallet_use, p_payment, 'pending',
    nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location
  ) returning * into v_order;

  -- Debit wallet (returned by the cancel trigger if voided).
  if v_wallet_use > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_wallet_use, 'spent', 'Used on ' || v_code, v_order.id, v_uid);
  end if;

  -- Debit redeemed points now (returned by the cancel trigger if voided).
  if v_redeem_pts > 0 then
    update public.profiles set points = points - v_redeem_pts where id = v_uid;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, -v_redeem_pts, 'Redeemed on ' || v_code);
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    v_unit := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      values (v_order.id, v_prod.id, v_prod.name, v_prod.icon, v_qty, v_unit);
    if not v_online and v_prod.stock is not null then
      update public.products set stock = greatest(0, stock - v_qty) where id = v_prod.id;
    end if;
  end loop;

  -- Award earned points now for immediate orders; online awards on payment.
  if not v_online and v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  return v_order;
end;
$function$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer) to authenticated;

-- Cancel trigger: return wallet credit AND redeemed points, and reverse any
-- earned points that were already awarded for the order.
create or replace function public.trg_wallet_restore()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    if coalesce(new.wallet_used, 0) > 0 and not coalesce(new.wallet_restored, false) then
      insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
        values (new.user_id, new.wallet_used, 'refund', 'Wallet returned (order cancelled)', new.id, new.user_id);
      new.wallet_restored := true;
    end if;
    if not coalesce(new.points_restored, false) then
      if coalesce(new.points_redeemed, 0) > 0 then
        update public.profiles set points = points + new.points_redeemed where id = new.user_id;
        insert into public.points_ledger (user_id, order_id, delta, reason)
          values (new.user_id, new.id, new.points_redeemed, 'Redeemed points returned (cancelled)');
      end if;
      if coalesce(new.points_earned, 0) > 0
         and exists (select 1 from public.points_ledger where order_id = new.id and delta > 0 and reason like 'Earned%') then
        update public.profiles set points = points - new.points_earned where id = new.user_id;
        insert into public.points_ledger (user_id, order_id, delta, reason)
          values (new.user_id, new.id, -new.points_earned, 'Earned points reversed (cancelled)');
      end if;
      new.points_restored := true;
    end if;
  end if;
  return new;
end $function$;
