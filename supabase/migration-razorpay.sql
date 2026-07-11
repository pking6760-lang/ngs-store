-- ============================================================================
-- MIGRATION: Razorpay online payments (server-verified)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Security model (mirrors the rest of the schema):
--   • The phone NEVER states an amount. place_order() computes the real total
--     from the database; the Razorpay order is created for THAT amount by the
--     Edge Function using the secret key (which never reaches the browser).
--   • An online order is created in a HELD state ('Awaiting payment'):
--       – it is NOT shown to the admin,
--       – points are NOT awarded,
--       – stock is NOT decremented,
--     until the payment signature is verified server-side.
--   • mark_order_paid() is the ONLY path that confirms an online order, and it
--     is executable only by the service role (the Edge Functions), never by a
--     customer. So a tampered phone cannot mark its own order "paid".
-- ============================================================================

-- 1) Reconciliation columns: link an order to its Razorpay ids.
alter table public.orders add column if not exists razorpay_order_id   text;
alter table public.orders add column if not exists razorpay_payment_id text;
create index if not exists orders_rzp_order_idx on public.orders(razorpay_order_id);

-- 2) place_order() — now defers confirmation for online payments.
--    Backward compatible: 'cod' and 'upi' behave exactly as before.
create or replace function public.place_order(
  p_items    jsonb,
  p_coupon   text default null,
  p_location jsonb default null,
  p_payment  text default 'upi',
  p_address  text default null
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
  -- Online (gateway) payments are held until the payment is verified server-side.
  v_online     boolean := lower(coalesce(p_payment, '')) in ('razorpay', 'online', 'card');
  v_status     text;
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

  -- 5) Insert the order + item snapshot. Online orders start HELD.
  v_status := case when v_online then 'Awaiting payment' else 'Placed' end;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, points_earned,
    total, payment_method, payment_status, address, distance_km, location
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_total, p_payment, 'pending', nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null
         else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = (v_line->>'id');
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      values (v_order.id, v_prod.id, v_prod.name, v_prod.icon, v_qty, v_prod.price);
    -- Decrement stock now ONLY for immediately-confirmed orders (COD/legacy).
    -- Online orders decrement on payment confirmation, so an abandoned payment
    -- never eats inventory.
    if not v_online and v_prod.stock is not null then
      update public.products set stock = greatest(0, stock - v_qty) where id = v_prod.id;
    end if;
  end loop;

  -- 6) Award points immediately for confirmed orders; online orders get their
  --    points inside mark_order_paid() once payment is verified.
  if not v_online and v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  return v_order;
end;
$$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text) to authenticated;

-- 3) mark_order_paid() — the ONLY confirmation path for an online order.
--    Executable only by the service role (the Edge Functions after they have
--    cryptographically verified the payment). Idempotent: the client callback
--    and the Razorpay webhook may both call it; only the first does the work.
create or replace function public.mark_order_paid(
  p_order      uuid,
  p_payment_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_line  record;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  -- Already confirmed → nothing to do (webhook + client both fire).
  if v_order.payment_status = 'paid' then
    return;
  end if;

  update public.orders set
    payment_status      = 'paid',
    status              = case when status = 'Awaiting payment' then 'Placed' else status end,
    razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
  where id = p_order;

  -- Decrement stock now (deferred from place_order for online orders).
  for v_line in
    select product_id, qty from public.order_items where order_id = p_order
  loop
    update public.products
      set stock = greatest(0, stock - v_line.qty)
      where id = v_line.product_id and stock is not null;
  end loop;

  -- Award the reward points recorded on the order, exactly once.
  if v_order.points_earned > 0
     and not exists (select 1 from public.points_ledger where order_id = p_order) then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_order.user_id, p_order, v_order.points_earned, 'Earned on ' || v_order.human_code);
    update public.profiles set points = points + v_order.points_earned
      where id = v_order.user_id;
  end if;
end;
$$;

-- Lock it down: customers must never be able to self-confirm a payment.
revoke all on function public.mark_order_paid(uuid, text) from public;
revoke all on function public.mark_order_paid(uuid, text) from anon;
revoke all on function public.mark_order_paid(uuid, text) from authenticated;
grant execute on function public.mark_order_paid(uuid, text) to service_role;
