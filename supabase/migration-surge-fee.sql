-- ============================================================================
-- MIGRATION: add an editable "surge charge" (bad-weather / peak premium)
-- Run this ONCE in the Supabase SQL editor if you set up the database before
-- this feature existed. Safe to re-run.
-- ============================================================================

-- 1) New columns (keep existing data)
alter table public.settings add column if not exists surge_fee numeric(10,2) not null default 20;
alter table public.orders   add column if not exists surge_fee numeric(10,2) not null default 0;

-- 2) Updated order function: applies the surge charge while surge mode is on,
--    and gives members free delivery on any day.
create or replace function public.place_order(
  p_items    jsonb,
  p_coupon   text default null,
  p_location jsonb default null,
  p_payment  text default 'upi'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles;
  v_settings   public.settings;
  v_line       jsonb;
  v_prod       public.products;
  v_qty        integer;
  v_item_total numeric := 0;
  v_cat_totals jsonb := '{}';
  v_discount   numeric := 0;
  v_coupon     public.coupons;
  v_eligible   numeric;
  v_delivery   numeric := 0;
  v_handling   numeric := 0;
  v_surge      numeric := 0;
  v_total      numeric;
  v_points     integer := 0;
  v_rewards    jsonb;
  v_order      public.orders;
  v_code       text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to place an order.';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then
    raise exception 'Profile not found.';
  end if;

  select * into v_settings from public.settings where id = 1;
  if not v_settings.store_open then
    raise exception 'The store is currently closed.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  -- 1) Price every line FROM THE DATABASE, check stock, build category totals.
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then
      raise exception 'Bad quantity in cart.';
    end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then
      raise exception 'A product in your cart is no longer available.';
    end if;
    if v_prod.stock is not null and v_prod.stock < v_qty then
      raise exception '% is out of stock.', v_prod.name;
    end if;
    v_item_total := v_item_total + v_prod.price * v_qty;
    v_cat_totals := jsonb_set(
      v_cat_totals,
      array[coalesce(v_prod.category,'_')],
      to_jsonb(coalesce((v_cat_totals->>coalesce(v_prod.category,'_'))::numeric, 0) + v_prod.price * v_qty)
    );
  end loop;

  -- 2) Validate the coupon (server-side) and compute the discount.
  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    select * into v_coupon from public.coupons
      where code = upper(trim(p_coupon)) and active;
    if v_coupon.code is not null then
      if v_coupon.category is not null and v_coupon.category <> '' then
        v_eligible := coalesce((v_cat_totals->>v_coupon.category)::numeric, 0);
      else
        v_eligible := v_item_total;
      end if;
      if v_eligible >= v_coupon.min_order and v_eligible > 0 then
        if v_coupon.type = 'percent' then
          v_discount := floor(v_eligible * v_coupon.value / 100);
        else
          v_discount := v_coupon.value;
        end if;
        v_discount := least(v_discount, v_item_total);
      else
        v_coupon.code := null;  -- didn't qualify → no coupon recorded
      end if;
    end if;
  end if;

  -- 3) Delivery + handling + surge from settings. Members get free delivery;
  --    the surge charge applies to everyone while surge mode is on.
  v_handling := v_settings.handling_fee;
  if v_item_total >= v_settings.free_delivery_above then
    v_delivery := 0;
  elsif v_profile.is_member then
    v_delivery := 0;
  else
    v_delivery := v_settings.delivery_fee;
  end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  -- 4) Total and reward points, both from server values.
  v_total := v_item_total - v_discount + v_delivery + v_handling + v_surge;
  v_rewards := v_settings.rewards;
  if coalesce((v_rewards->>'earnPer')::numeric, 0) > 0 then
    v_points := floor((v_item_total - v_discount) / (v_rewards->>'earnPer')::numeric)
                * coalesce((v_rewards->>'earnPoints')::int, 0);
  end if;

  -- 5) Insert the order + items atomically; snapshot server prices.
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, points_earned,
    total, payment_method, payment_status, distance_km, location
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, 'Placed', null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_total, p_payment, 'pending',
    case when p_location is null then null
         else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      values (v_order.id, v_prod.id, v_prod.name, v_prod.icon, v_qty, v_prod.price);
    if v_prod.stock is not null then
      update public.products set stock = greatest(0, stock - v_qty) where id = v_prod.id;
    end if;
  end loop;

  -- 6) Award points via the ledger + profile balance (server-only path).
  if v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    -- Runs as the function owner (postgres), so the profile guard trusts it.
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  return v_order;
end;
$$;

-- Customers may execute place_order, but only through this vetted function.
grant execute on function public.place_order(jsonb, text, jsonb, text) to authenticated;
