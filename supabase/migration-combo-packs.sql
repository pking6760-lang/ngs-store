-- Combo packs: several products, one price you set.
--
-- The point is margin control. Sold item by item, a basket's margin is whatever
-- the individual prices happen to give -- on oil that's 2.6%. Sold as a pack you
-- set one price over a mix you choose, so a thin headline item can ride along
-- with items that actually earn.
--
-- DESIGN: a combo IS a product (products.combo_items), and it DISSOLVES into its
-- components when the order is placed. Nothing downstream learns a new concept:
--
--   * the picker scans real barcodes -- a "Diwali Pack" line would have none
--   * stock comes off each component, which is what actually leaves the shelf
--   * margin, the free-delivery gate, coupon caps, the points budget and the
--     loss sweep all read order_items and keep working with no change at all
--   * picking pay counts the real lines and units, which is the real work
--
-- The alternative -- a combo as its own order line -- would have needed every
-- one of those to special-case it.

begin;

alter table public.products
  add column if not exists combo_items jsonb not null default '[]'::jsonb;

comment on column public.products.combo_items is
  'Components of a combo pack: [{"id": product_id, "qty": n}]. Non-empty means this product is a combo and is expanded into its components when ordered.';

-- Split a combo's price across its components, in proportion to what each part
-- would cost on its own, and return a flat item list.
--
-- The allocation matters: order_items is what the shop's own margin reporting
-- reads, so putting the whole combo price on one line would make that component
-- look wildly profitable and the rest look like losses. Proportional keeps every
-- line honest. The last component absorbs the rounding remainder so the parts
-- always sum to exactly the combo price -- never a paisa more or less.
create or replace function public.expand_combos(p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_line jsonb; v_prod public.products; v_qty int;
  v_comp jsonb; v_cprod public.products;
  v_ref numeric; v_budget numeric; v_share numeric; v_cqty int;
  v_n int; v_i int;
begin
  if p_items is null then return '[]'::jsonb; end if;
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    select * into v_prod from public.products where id = (v_line->>'id');
    if v_prod.id is null or coalesce(jsonb_array_length(v_prod.combo_items), 0) = 0 then
      v_out := v_out || jsonb_build_array(v_line);
      continue;
    end if;

    -- What the components would come to at their own prices.
    v_ref := 0;
    for v_comp in select * from jsonb_array_elements(v_prod.combo_items) loop
      select * into v_cprod from public.products where id = (v_comp->>'id');
      if v_cprod.id is not null then
        v_ref := v_ref + v_cprod.price * coalesce((v_comp->>'qty')::int, 0);
      end if;
    end loop;
    if v_ref <= 0 then
      -- Components missing or free: pass the combo through untouched rather than
      -- silently dropping the line from the customer's order.
      v_out := v_out || jsonb_build_array(v_line);
      continue;
    end if;

    v_budget := v_prod.price * v_qty;
    v_n := jsonb_array_length(v_prod.combo_items);
    v_i := 0;
    for v_comp in select * from jsonb_array_elements(v_prod.combo_items) loop
      v_i := v_i + 1;
      select * into v_cprod from public.products where id = (v_comp->>'id');
      continue when v_cprod.id is null;
      v_cqty := coalesce((v_comp->>'qty')::int, 0) * v_qty;
      continue when v_cqty <= 0;
      if v_i = v_n then
        v_share := v_budget;                       -- last line absorbs the rounding
      else
        v_share := round(v_prod.price * v_qty
                         * (v_cprod.price * coalesce((v_comp->>'qty')::int, 0)) / v_ref, 2);
        v_budget := v_budget - v_share;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'id', v_cprod.id, 'qty', v_cqty,
        'unit', round(v_share / v_cqty, 4),        -- forced price: no bulk/member tier on a pack
        'comboId', v_prod.id, 'comboName', v_prod.name));
    end loop;
  end loop;
  return v_out;
end; $$;

grant execute on function public.expand_combos(jsonb) to anon, authenticated;

-- How many of this combo the shelf can actually make, from its scarcest part.
create or replace function public.combo_stock(p_combo text)
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select min(floor(coalesce(c.stock, 2147483647) / greatest((i->>'qty')::int, 1)))::int
    from public.products p
    cross join lateral jsonb_array_elements(p.combo_items) as i
    join public.products c on c.id = (i->>'id')
   where p.id = p_combo;
$$;

grant execute on function public.combo_stock(text) to anon, authenticated;

commit;
