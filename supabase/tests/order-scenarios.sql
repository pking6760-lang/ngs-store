-- Every scenario against ONE real cart (the items from a placed order), run
-- through the live engine and rolled back. Same technique as the loss sweep,
-- but wide instead of deep: one cart, every condition it could have met.
create or replace function public._order_scenarios(p_uid uuid, p_order uuid)
returns table(km numeric, member boolean, surge boolean, coupon text, redeem_pts int,
              item_total numeric, margin numeric, delivery numeric, handling numeric,
              surge_fee numeric, small_cart numeric, discount numeric, redeemed numeric,
              scratch numeric, picker numeric, rider numeric, profit numeric, err text)
language plpgsql
as $$
declare
  v_ops public.ops_config; v_items jsonb; v_oid uuid; v_ord public.orders;
  v_lines int; v_units int; v_marg numeric; v_pick numeric; v_ride numeric;
  v_max numeric; d numeric; m boolean; sg boolean; c text; pts int; v_mode text;
begin
  select * into v_ops from public.ops_config where id = 1;
  select coalesce(max_distance_km, 3), delivery_mode into v_max, v_mode
    from public.settings where id = 1;
  select jsonb_agg(jsonb_build_object('id', product_id, 'qty', qty)) into v_items
    from public.order_items where order_id = p_order;

  foreach d in array array[0.1, 1.0, 1.5, 2.5, v_max] loop
    foreach m in array array[false, true] loop
      foreach sg in array array[false, true] loop
        for c in select unnest(array['none','FLAT49','PCT20','GUAR49']) loop
          foreach pts in array array[0, 100000] loop
            km := d; member := m; surge := sg; coupon := c; redeem_pts := pts;
            item_total := null; margin := null; delivery := null; handling := null;
            surge_fee := null; small_cart := null; discount := null; redeemed := null;
            scratch := null; picker := null; rider := null; profit := null; err := null;
            begin
              update public.settings set delivery_mode = case when sg then 'surge' else 'normal' end where id = 1;
              update public.profiles set points = 1000000 where id = p_uid;
              select id into v_oid from public._place_order_core(
                p_uid, v_items, case when c = 'none' then null else c end,
                jsonb_build_object('distanceKm', d, 'lat', 28.5, 'lng', 77.1),
                'upi', 'scenario', 0, pts, false, false, null);
              select * into v_ord from public.orders where id = v_oid;
              select count(*), coalesce(sum(oi.qty),0) into v_lines, v_units
                from public.order_items oi where oi.order_id = v_oid;
              select coalesce(sum((oi.price - pc.cost) * oi.qty), 0) into v_marg
                from public.order_items oi join public.product_costs pc on pc.product_id = oi.product_id
               where oi.order_id = v_oid and pc.cost is not null;
              v_pick := round(v_ops.picker_pack_fee + v_lines*v_ops.picker_per_line
                              + v_units*v_ops.picker_per_unit, 2);
              v_ride := greatest(v_ops.rider_base + d*v_ops.rider_per_km, v_ops.rider_min)
                        + case when coalesce(v_ord.surge_fee,0) > 0 then v_ops.peak_bonus else 0 end;
              item_total := v_ord.item_total;      margin     := round(v_marg,2);
              delivery   := coalesce(v_ord.delivery_fee,0) + coalesce(v_ord.sponsored_amount,0);
              handling   := coalesce(v_ord.handling,0);
              surge_fee  := coalesce(v_ord.surge_fee,0);
              small_cart := coalesce(v_ord.small_cart_fee,0);
              discount   := coalesce(v_ord.discount,0) + coalesce(v_ord.welcome_discount,0);
              redeemed   := coalesce(v_ord.points_discount,0);
              scratch    := coalesce(v_ord.scratch_wallet,0) + coalesce(v_ord.member_bonus_wallet,0);
              picker     := v_pick; rider := round(v_ride,2);
              profit     := round(margin + delivery + handling + surge_fee + small_cart
                                  - v_pick - v_ride - discount - redeemed - scratch, 2);
              raise exception 'SCENARIO_ROLLBACK';
            exception when others then
              if sqlerrm <> 'SCENARIO_ROLLBACK' then err := left(sqlerrm, 80); profit := null; end if;
            end;
            return next;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end; $$;
