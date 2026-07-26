-- Exhaustive loss hunt. Places REAL orders through _place_order_core across the
-- full combination space, computes the true shop P&L of each, and rolls every
-- one back. Nothing is simulated or re-derived: whatever the live engine does,
-- this measures.
--
-- True P&L = item margin + every fee collected
--            − picker pay − rider pay
--            − coupon discount − points redeemed − scratch payout − welcome credit
-- The engine's own v_profit omits the last two, so this is deliberately stricter
-- than the engine's own view of itself.

create or replace function public._loss_sweep(p_uid uuid)
returns table(scenario text, km numeric, member boolean, coupon text, redeem_pts int,
              item_total numeric, margin numeric, fees numeric, discount numeric,
              redeemed numeric, scratch numeric, picker numeric, rider numeric,
              profit numeric, err text)
language plpgsql
as $$
declare
  v_ops public.ops_config;
  v_items jsonb; v_oid uuid; v_ord public.orders;
  v_lines int; v_units int; v_marg numeric; v_pick numeric; v_ride numeric;
  s record; d numeric; m boolean; c text; pts int; v_max numeric;
begin
  select * into v_ops from public.ops_config where id = 1;
  -- Distances come from the shop's OWN radius, not a hardcoded list. Testing
  -- past it reports losses on orders the app already refuses ("we're coming to
  -- your area soon"), which is noise. The one over-radius probe is kept on
  -- purpose: it must come back as an error, proving the server refuses it too.
  select coalesce(max_distance_km, 3) into v_max from public.settings where id = 1;

  for s in
    -- One row per cart shape, built from the real catalogue.
    select 'cheap x20 (Rs10 thin)' as name,
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 2))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and pc.cost>0 and p.price<=10 and (p.price-pc.cost)<3 limit 10) q) as items
    union all select 'oil x10 (bulk thin-pct)',
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 10))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and p.price>=150 and (p.price-pc.cost)/p.price*100 < 6 limit 1) q)
    union all select 'single cheap item',
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 1))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and pc.cost>0 and p.price<=10 limit 1) q)
    union all select 'mixed mid basket',
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 2))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and pc.cost>0 and p.price between 20 and 99 limit 6) q)
    union all select 'big expensive',
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 2))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and pc.cost>0 and p.price>=200 limit 3) q)
    union all select 'many lines slow pick',
           (select jsonb_agg(jsonb_build_object('id', id, 'qty', 1))
              from (select p.id from public.products p join public.product_costs pc on pc.product_id=p.id
                    where p.active and pc.cost>0 limit 20) q)
  loop
    continue when s.items is null;
    foreach d in array array[0.3, round(v_max/2, 1), v_max, v_max + 1.5] loop
      foreach m in array array[false, true] loop
        for c in select unnest(array['none','CAPPED49','GUARANTEED49']) loop
          foreach pts in array array[0, 100000] loop
            scenario := s.name; km := d; member := m; coupon := c; redeem_pts := pts;
            item_total := null; margin := null; fees := null; discount := null;
            redeemed := null; scratch := null; picker := null; rider := null;
            profit := null; err := null;
            begin
              -- Give the test buyer plenty of points so the redeem cap is what bites.
              update public.profiles set points = 1000000 where id = p_uid;
              select id into v_oid from public._place_order_core(
                p_uid, s.items,
                case when c = 'none' then null else c end,
                jsonb_build_object('distanceKm', d, 'lat', 28.5, 'lng', 77.1),
                'upi', 'sweep', 0, pts, false, false, null);
              select * into v_ord from public.orders where id = v_oid;
              select count(*), coalesce(sum(oi.qty),0) into v_lines, v_units
                from public.order_items oi where oi.order_id = v_oid;
              select coalesce(sum((oi.price - pc.cost) * oi.qty), 0) into v_marg
                from public.order_items oi
                join public.product_costs pc on pc.product_id = oi.product_id
               where oi.order_id = v_oid and pc.cost is not null;
              v_pick := round(v_ops.picker_pack_fee + v_lines*v_ops.picker_per_line
                              + v_units*v_ops.picker_per_unit, 2);
              v_ride := greatest(v_ops.rider_base + d*v_ops.rider_per_km, v_ops.rider_min)
                        + case when coalesce(v_ord.surge_fee,0) > 0 then v_ops.peak_bonus else 0 end;
              item_total := v_ord.item_total;
              margin     := round(v_marg, 2);
              fees       := coalesce(v_ord.delivery_fee,0) + coalesce(v_ord.handling,0)
                            + coalesce(v_ord.surge_fee,0) + coalesce(v_ord.small_cart_fee,0)
                            + coalesce(v_ord.sponsored_amount,0);
              discount   := coalesce(v_ord.discount,0) + coalesce(v_ord.welcome_discount,0);
              redeemed   := coalesce(v_ord.points_discount,0);
              scratch    := coalesce(v_ord.scratch_wallet,0) + coalesce(v_ord.member_bonus_wallet,0);
              picker     := v_pick; rider := round(v_ride,2);
              profit     := round(margin + fees - v_pick - v_ride - discount - redeemed - scratch, 2);
              raise exception 'SWEEP_ROLLBACK';
            exception when others then
              if sqlerrm <> 'SWEEP_ROLLBACK' then err := left(sqlerrm, 90); profit := null; end if;
            end;
            return next;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end; $$;
