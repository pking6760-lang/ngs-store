-- Keep a category off the shop front without taking it out of the shop.
--
-- The owner does not want cigarettes on his home page. They are stock he sells,
-- so they stay buyable and findable — what changes is that the app stops
-- PUTTING THEM IN FRONT OF PEOPLE. Those are different things and the app was
-- only doing the second by accident.
--
-- Six places on the home page could show them, and it only takes one to undo the
-- intention:
--
--   1. the "Shop by category" tile
--   2. the category's own rail lower down
--   3. Best Prices  — one cigarette carries a bait flag today
--   4. Almost Gone  — any pack that drops below 5 in stock
--   5. Buy again    — for anyone who has bought them before
--   6. the cart's attach suggestion
--
-- So the rule lives on the CATEGORY, once, and every surface reads it. A flag
-- per product would need remembering on all eighteen and on the nineteenth
-- somebody adds next month.
--
-- Worth saying plainly: India's tobacco law (COTPA) prohibits advertising and
-- promotion of tobacco products. Selling them to a customer who asks is trade;
-- putting them in a "Best Prices" carousel is promotion. This change puts the
-- app on the right side of that line, which is where the owner wanted it anyway.

begin;

alter table public.categories
  add column if not exists hidden_from_home boolean not null default false;

comment on column public.categories.hidden_from_home is
  'Kept off the home page entirely -- no tile, no rail, no Best Prices, Almost Gone, Buy again or cart suggestion. Still sold: search finds it and the category page works if opened directly.';

update public.categories
   set hidden_from_home = true
 where name ilike '%tobacco%' or name ilike '%cigar%';

-- The cart's attach engine suggests an item that pays for the trip. It must
-- never reach for something the shop has chosen not to display.
create or replace function public.suggest_attach(p_items jsonb,
                                                 p_distance_km numeric default 0,
                                                 p_limit int default 3)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ops public.ops_config; v_settings public.settings;
  v_line jsonb; v_prod public.products; v_qty int; v_cost numeric;
  v_uid uuid := auth.uid();
  v_total numeric := 0; v_margin numeric := 0; v_lines int := 0; v_units int := 0;
  v_magnet_only boolean := true; v_has_any boolean := false;
  v_cats text[] := '{}'; v_ids text[] := '{}';
  v_thresh numeric; v_thresh_pct numeric; v_dist numeric := coalesce(p_distance_km, 0);
  v_picker numeric; v_rider numeric; v_hand numeric; v_fee numeric; v_band numeric;
  v_far boolean; v_bar numeric; v_floor numeric; v_pif numeric;
  v_picks jsonb := '[]'::jsonb; r record;
  v_two_margin numeric := 0; v_two_ct int := 0;
  v_rung int := 0; v_gain numeric;
begin
  select * into v_ops from public.ops_config where id = 1;
  select * into v_settings from public.settings where id = 1;
  if p_items is null or jsonb_array_length(p_items) = 0 then return null; end if;
  v_thresh := coalesce(v_ops.magnet_margin_rupees, 5);
  v_thresh_pct := coalesce(v_ops.magnet_margin_pct, 8);

  for v_line in select * from jsonb_array_elements(public.expand_combos(p_items)) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    continue when v_qty <= 0;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    continue when v_prod.id is null;
    v_has_any := true;
    v_total := v_total + v_prod.price * v_qty;
    v_lines := v_lines + 1; v_units := v_units + v_qty;
    v_ids := v_ids || v_prod.id;
    if v_prod.category is not null then v_cats := v_cats || v_prod.category; end if;
    select cost into v_cost from public.product_costs where product_id = v_prod.id;
    if v_cost is not null then
      v_margin := v_margin + (v_prod.price - v_cost) * v_qty;
      if (v_prod.price - v_cost) >= v_thresh
         and v_prod.price > 0
         and ((v_prod.price - v_cost) / v_prod.price * 100) >= v_thresh_pct then
        v_magnet_only := false;
      end if;
    end if;
  end loop;
  if not v_has_any then return null; end if;

  v_hand := v_settings.handling_fee;
  v_far  := v_dist >= coalesce(v_ops.far_zone_km, 999);
  v_bar  := case when v_far then coalesce(v_ops.free_delivery_far_above, v_settings.free_delivery_above)
                 else v_settings.free_delivery_above end;
  v_band := case
    when v_dist >= coalesce(v_ops.far_zone_km_2, 1e9) then coalesce(v_ops.delivery_fee_far, v_settings.delivery_fee)
    when v_far then coalesce(v_ops.delivery_fee_mid, v_settings.delivery_fee)
    else v_settings.delivery_fee end;
  v_picker := case when v_ops.coverage_picking = 'staff' then
      round(coalesce(v_ops.picker_pack_fee,0) + v_lines*coalesce(v_ops.picker_per_line,0)
            + v_units*coalesce(v_ops.picker_per_unit,0), 2) else 0 end;
  v_rider := case when v_ops.coverage_delivery = 'staff' then
      greatest(coalesce(v_ops.rider_base,0) + v_dist*coalesce(v_ops.rider_per_km,0),
               coalesce(v_ops.rider_min,0)) else 0 end;
  v_floor := greatest(coalesce(v_ops.min_free_delivery_profit, 8),
                      round(v_total * coalesce(v_ops.min_free_delivery_profit_pct, 0) / 100));
  v_pif := v_margin + v_hand - v_picker - v_rider;
  v_fee := case when v_total >= v_bar and v_pif >= v_floor then 0 else v_band end;

  for r in
    select p.id, p.name, p.price, p.image_url, p.unit,
           round(p.price - pc.cost, 2) as marg,
           coalesce(cp.n, 0) * 6
             + coalesce(mine.n, 0) * 4
             + coalesce(af.w, 0) * 2
             + least(round(p.price - pc.cost) / 10.0, 2) as score
      from public.products p
      join public.product_costs pc on pc.product_id = p.id
      left join public.categories cat on cat.id = p.category
      left join lateral (
        select count(*)::numeric as n
          from public.order_items x
          join public.order_items y on y.order_id = x.order_id
         where x.product_id = p.id and y.product_id = any(v_ids)) cp on true
      left join lateral (
        select count(*)::numeric as n
          from public.order_items x join public.orders o on o.id = x.order_id
         where x.product_id = p.id and v_uid is not null and o.user_id = v_uid) mine on true
      left join lateral (
        select max(ca.weight) as w from public.category_affinity ca
         where ca.b = p.category and ca.a = any(v_cats)) af on true
     where p.active
       and coalesce(p.in_stock, true)
       and (p.stock is null or p.stock > 0)
       and coalesce(jsonb_array_length(p.combo_items), 0) = 0
       and pc.cost is not null
       -- Never suggest from a category the shop keeps off its front page.
       and not coalesce(cat.hidden_from_home, false)
       and (p.price - pc.cost) >= v_thresh
       and p.price > 0 and ((p.price - pc.cost) / p.price * 100) >= v_thresh_pct
       and not (p.id = any(v_ids))
     order by score desc, marg desc
     limit greatest(coalesce(p_limit, 3), 2)
  loop
    v_picks := v_picks || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'name', r.name, 'price', r.price, 'unit', r.unit, 'image', r.image_url));
    if v_two_ct < 2 then v_two_margin := v_two_margin + r.marg; v_two_ct := v_two_ct + 1; end if;
  end loop;
  if jsonb_array_length(v_picks) = 0 then return null; end if;

  if v_fee > 0 and v_two_ct = 2 then
    v_gain := v_two_margin - v_fee
              - 2 * coalesce(v_ops.picker_per_line, 0)
              - 2 * coalesce(v_ops.picker_per_unit, 0);
    if v_gain > 0 then v_rung := 2; end if;
  end if;

  return jsonb_build_object(
    'magnetOnly',   v_magnet_only,
    'rung',         v_rung,
    'deliveryFee',  v_fee,
    'unlocksFree',  v_rung = 2,
    'items',        v_picks);
end; $$;

revoke all on function public.suggest_attach(jsonb, numeric, int) from public;
grant execute on function public.suggest_attach(jsonb, numeric, int) to anon, authenticated;

commit;
