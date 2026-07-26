-- Honest coupon amounts in the cart.
--
-- A coupon's payout is capped at the cart's item margin, so a "₹49 OFF" coupon
-- can pay out less on a thin-margin cart (mustard oil, dairy). The cart used to
-- promise the full face value and the customer only found out at checkout —
-- order NGS1582 advertised ₹49 and paid ₹31.
--
-- The client cannot work the cap out for itself: that needs product_costs, which
-- must never reach a customer's device. So the cart asks the server for the real
-- number instead. This function returns ONLY the resulting discount and whether
-- it was capped — no cost, no margin, nothing that reveals buying prices.

create or replace function public.coupon_quote(p_items jsonb, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  if coalesce(v_profile.is_member, false) then
    v_pct := coalesce((select (rewards->'member'->>'markupPct')::numeric from public.settings where id = 1), 0);
  end if;

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
  v_discount := least(v_discount, greatest(0, floor(v_item_margin)));

  return jsonb_build_object(
    'ok', true,
    'code', v_coupon.code,
    'discount', v_discount,          -- what this cart actually gets
    'faceValue', v_face,             -- the "up to" figure
    'capped', v_discount < v_face    -- true when the cart's margin limited it
  );
end;
$$;

revoke all on function public.coupon_quote(jsonb, text) from public, anon;
grant execute on function public.coupon_quote(jsonb, text) to authenticated;
