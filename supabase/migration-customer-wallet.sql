-- ════════════════════════════════════════════════════════════════════════════
-- Customer NGS Wallet (store credit).
--   • Refunds are credited here (never to the bank) and can be spent on orders.
--   • Customers can top up (added later via the payment flow).
--   • Wallet applied at checkout reduces the amount due; it's debited when the
--     order is placed and automatically returned if the order is cancelled.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_wallet (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric(10,2) not null,          -- + credit (refund/topup) | − debit (spent)
  kind        text not null,                   -- 'refund' | 'topup' | 'spent' | 'adjust'
  note        text,
  order_id    uuid,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists customer_wallet_user_idx on public.customer_wallet (user_id, created_at desc);

alter table public.customer_wallet enable row level security;
drop policy if exists "wallet read own" on public.customer_wallet;
create policy "wallet read own" on public.customer_wallet
  for select using (user_id = auth.uid() or public.is_admin());
-- No insert/update/delete policies → only SECURITY DEFINER functions write.

-- Order columns for wallet usage + refunds.
alter table public.orders add column if not exists wallet_used      numeric(10,2) not null default 0;
alter table public.orders add column if not exists wallet_restored  boolean not null default false;
alter table public.orders add column if not exists refunded_amount  numeric(10,2) not null default 0;
alter table public.orders add column if not exists refunded_at      timestamptz;

-- Caller's own wallet balance.
create or replace function public.wallet_balance()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(amount), 0)::numeric from public.customer_wallet where user_id = auth.uid();
$$;

-- Admin: refund an order to the customer's NGS wallet (store credit).
create or replace function public.admin_refund_to_wallet(p_order uuid, p_amount numeric, p_note text default null)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_total numeric; v_already numeric;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a refund amount greater than 0.'; end if;
  select user_id, total, coalesce(refunded_amount, 0) into v_uid, v_total, v_already
    from public.orders where id = p_order;
  if v_uid is null then raise exception 'Order not found.'; end if;
  if v_already + p_amount > v_total then raise exception 'Refund would exceed the order total.'; end if;

  insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
    values (v_uid, p_amount, 'refund', coalesce(nullif(trim(p_note), ''), 'Refund'), p_order, auth.uid());
  update public.orders set refunded_amount = v_already + p_amount, refunded_at = now() where id = p_order;
  insert into public.notifications (user_id, title, body)
    values (v_uid, 'Refund added to your NGS Wallet',
            '₹' || trim(to_char(p_amount, 'FM999999990.00')) || ' has been added to your NGS Wallet. Use it on your next order.');
  return p_amount;
end $$;

-- Return the wallet amount if an order is cancelled (it was debited at placement).
create or replace function public.trg_wallet_restore()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled'
     and coalesce(new.wallet_used, 0) > 0 and not coalesce(new.wallet_restored, false) then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (new.user_id, new.wallet_used, 'refund', 'Wallet returned (order cancelled)', new.id, new.user_id);
    new.wallet_restored := true;
  end if;
  return new;
end $$;
drop trigger if exists wallet_restore_on_cancel on public.orders;
create trigger wallet_restore_on_cancel before update on public.orders
  for each row execute function public.trg_wallet_restore();

-- ── place_order, now wallet-aware (new last param p_wallet). ────────────────
drop function if exists public.place_order(jsonb, text, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_coupon text DEFAULT NULL::text, p_location jsonb DEFAULT NULL::jsonb, p_payment text DEFAULT 'upi'::text, p_address text DEFAULT NULL::text, p_wallet numeric DEFAULT 0)
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
  v_item_total   numeric := 0;
  v_qualify_total numeric := 0;
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
  v_rewards      jsonb;
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

  v_handling := v_settings.handling_fee;
  if v_qualify_total >= v_settings.free_delivery_above then v_delivery := 0;
  elsif v_profile.is_member then v_delivery := 0;
  else v_delivery := v_settings.delivery_fee; end if;
  if v_settings.delivery_mode = 'surge' and v_item_total > 0 then
    v_surge := coalesce(v_settings.surge_fee, 0);
  end if;

  v_total := v_item_total - v_discount + v_delivery + v_handling + v_surge;

  -- Apply NGS wallet credit chosen by the customer (capped at balance & total).
  if coalesce(p_wallet, 0) > 0 then
    select coalesce(sum(amount), 0) into v_wallet_bal from public.customer_wallet where user_id = v_uid;
    v_wallet_use := least(p_wallet, greatest(v_wallet_bal, 0), v_total);
    if v_wallet_use < 0 then v_wallet_use := 0; end if;
    v_total := v_total - v_wallet_use;
  end if;

  -- Cash-on-delivery cap on the amount the rider actually collects.
  if lower(coalesce(p_payment, '')) = 'cod'
     and coalesce(v_settings.cod_customer_limit, 0) > 0
     and v_total > v_settings.cod_customer_limit then
    raise exception 'Cash on delivery isn''t available above ₹%. Please pay online.',
      trunc(v_settings.cod_customer_limit)::text;
  end if;

  v_rewards := v_settings.rewards;
  if coalesce((v_rewards->>'earnPer')::numeric, 0) > 0 then
    v_points := floor((v_item_total - v_discount) / (v_rewards->>'earnPer')::numeric)
                * coalesce((v_rewards->>'earnPoints')::int, 0);
  end if;

  v_status := case when v_online then 'Awaiting payment' else 'Placed' end;
  v_code := 'NGS' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, discount, coupon_code, delivery_fee, handling, surge_fee, points_earned,
    total, wallet_used, payment_method, payment_status, address, distance_km, location
  ) values (
    v_code, v_uid, v_profile.name, v_profile.phone, v_status, null, v_profile.is_member,
    v_item_total, v_discount, v_coupon.code, v_delivery, v_handling, v_surge, v_points,
    v_total, v_wallet_use, p_payment, 'pending', nullif(trim(coalesce(p_address, '')), ''),
    case when p_location is null then null else round((p_location->>'distanceKm')::numeric, 2) end,
    p_location
  ) returning * into v_order;

  -- Debit the wallet now (returned by the cancel trigger if the order is voided).
  if v_wallet_use > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_wallet_use, 'spent', 'Used on ' || v_code, v_order.id, v_uid);
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

  if not v_online and v_points > 0 then
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (v_uid, v_order.id, v_points, 'Earned on ' || v_code);
    update public.profiles set points = points + v_points where id = v_uid;
  end if;

  return v_order;
end;
$function$;

-- Grants: keep the client-facing ones on authenticated; lock internals.
grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric) to authenticated;
grant execute on function public.wallet_balance() to authenticated;
grant execute on function public.admin_refund_to_wallet(uuid, numeric, text) to authenticated;
revoke execute on function public.wallet_balance() from public, anon;
revoke execute on function public.admin_refund_to_wallet(uuid, numeric, text) from public, anon;
revoke execute on function public.trg_wallet_restore() from public, anon, authenticated;
