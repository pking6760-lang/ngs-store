-- Magnets and earners, and the attach engine that pairs them.
--
-- THE MODEL (the owner's, and the numbers agree with it):
-- milk, Rs10 biscuits, oil and atta are not profit. They're the magnet that
-- brings someone in. Measured on the live catalogue: 57 products earn under Rs5
-- a unit (avg Rs2.04) and 26 earn Rs5+ (avg Rs15.83). A magnet cannot pay for a
-- Rs25 trip and was never meant to.
--
-- So the order only works when an EARNER rides along with the magnet. On real
-- orders that's worth a lot:
--
--     carts with an earner   39 orders   avg profit Rs26.99
--     magnet-only carts      17 orders   avg profit Rs12.57
--
-- The engine's job in one line: IF THE CART IS ALL MAGNET, ATTACH AN EARNER.
-- Not "get to Rs199" -- a Rs950 pure-oil cart is still a magnet-only cart. Cart
-- VALUE is not the signal; cart COMPOSITION is.
--
-- WHY NOT LEAD WITH FREE DELIVERY: an extra line is worth about Rs6-7 of profit;
-- waiving delivery costs Rs20. Measured on a Rs180 cart, adding the single best
-- mid-priced item and giving free delivery nets Rs20.42, against Rs25.50 for
-- simply charging the fee. One item can never pay for it. Two good ones can
-- (Rs34.67), which is why the free-delivery rung needs two and a margin check.
-- So the engine uses the CHEAPEST rung that can work:
--
--     rung 0  suggest, no offer       costs Rs0    always allowed
--     rung 1  small bundle discount   costs a few  when rung 0 needs help
--     rung 2  free-delivery unlock    costs Rs20   only if 2 items clear it AND
--                                                  the shop ends up better off
--
-- Classification is derived from margin, never a toggle: the owner already types
-- the cost, and an item's own margin is exactly what decides whether it can fund
-- a trip. Nothing to maintain and nothing to get wrong.

begin;

alter table public.ops_config
  add column if not exists magnet_margin_rupees numeric not null default 5,
  add column if not exists magnet_margin_pct numeric not null default 8;

-- TWO tests, because items are magnets for two different reasons and each one
-- is invisible to the other test:
--   Fortune oil Rs195   Rs10.00 margin (passes rupees)  5.1% (fails percent)
--   Bourbon     Rs10    Rs1.14 margin (fails rupees)   11.4% (passes percent)
-- Both are magnets, as the owner said. So a magnet fails EITHER test, and an
-- EARNER has to clear BOTH -- enough cash to matter and enough percentage that
-- selling more of it is actually worth doing.
comment on column public.ops_config.magnet_margin_rupees is
  'An EARNER must make at least this many rupees a unit. Below it the item is a MAGNET: traffic, not profit.';
comment on column public.ops_config.magnet_margin_pct is
  'An EARNER must also make at least this margin %. Catches big-ticket thin items (oil, cigarettes) that clear the rupee test on size alone.';

-- Which categories genuinely go together. Seeded with kirana sense so the very
-- first suggestion is sensible; co-purchase from real orders is layered on top
-- in the scorer and takes over as it accumulates.
create table if not exists public.category_affinity (
  a text not null,
  b text not null,
  weight numeric not null default 1,
  primary key (a, b)
);
alter table public.category_affinity enable row level security;
revoke all on public.category_affinity from anon, authenticated;

insert into public.category_affinity (a, b, weight) values
  ('oil-ghee-71eb',        'atta-rice-dal-u1h8',   3),
  ('oil-ghee-71eb',        'sauces-spreads-sm2c',  2),
  ('atta-rice-dal-u1h8',   'oil-ghee-71eb',        3),
  ('atta-rice-dal-u1h8',   'sauces-spreads-sm2c',  2),
  ('atta-rice-dal-u1h8',   'instant',              1),
  ('instant',              'sauces-spreads-sm2c',  3),
  ('instant',              'beverages',            2),
  ('sauces-spreads-sm2c',  'instant',              3),
  ('sauces-spreads-sm2c',  'atta-rice-dal-u1h8',   2),
  ('snacks',               'beverages',            3),
  ('beverages',            'snacks',               3),
  ('dairy-bread',          'bakery',               3),
  ('dairy-bread',          'snacks',               2),
  ('bakery',               'dairy-bread',          3),
  ('household',            'personal',             2),
  ('personal',             'household',            2)
on conflict (a, b) do update set weight = excluded.weight;

-- What to attach to this cart, and how hard we have to push to get it.
--
-- Returns null when there is nothing worth suggesting -- an empty cart, no
-- earner in stock, or a cart that already has one. Silence is the right answer
-- more often than a suggestion is.
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
      -- One earner in the cart and it is no longer a magnet-only cart.
      if (v_prod.price - v_cost) >= v_thresh
         and v_prod.price > 0
         and ((v_prod.price - v_cost) / v_prod.price * 100) >= v_thresh_pct then
        v_magnet_only := false;
      end if;
    end if;
  end loop;
  if not v_has_any then return null; end if;

  -- What the cart costs to fulfil, and what it pays today.
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

  -- Candidate earners, ranked by how much sense they make next to this cart:
  -- what people actually bought with these items first, then what THIS customer
  -- has bought before, then category affinity, then margin as a tiebreak.
  for r in
    select p.id, p.name, p.price, p.image_url, p.unit,
           round(p.price - pc.cost, 2) as marg,
           coalesce(cp.n, 0) * 6
             + coalesce(mine.n, 0) * 4
             + coalesce(af.w, 0) * 2
             + least(round(p.price - pc.cost) / 10.0, 2) as score
      from public.products p
      join public.product_costs pc on pc.product_id = p.id
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
       and (p.price - pc.cost) >= v_thresh          -- earners only; a magnet can't help
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

  -- Which rung. Free delivery is the expensive one, so it has to earn its place:
  -- taking the top two must leave the shop BETTER OFF than simply charging the
  -- fee, after the extra picking those two lines cost.
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
