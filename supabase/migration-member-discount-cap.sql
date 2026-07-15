-- Member/shelf pricing: cap the maximum discount off MRP (all price paths).
--
-- Problem: the "max discount" cap was first applied only to member_price_floor,
-- but the auto-priced SHELF price has its own floor (cost + floor_markup), which
-- for a cheap-cost item lands well below the cap — e.g. cost ₹12, MRP ₹20 gave a
-- shelf price of ₹13 (35% off). A member pays min(shelf, member floor), so the
-- ₹13 shelf undercut the ₹16 member floor and the discount was still too deep.
--
-- Fix: the cap (MRP − maxDiscountPct%) is now a floor on EVERY price path in
-- smart_reprice() — the shelf price, the bulk-tier floor, and member_price_floor.
-- So nothing ever sells more than maxDiscountPct% off MRP, while the cost-margin
-- floor still guarantees no sale below cost. Config: rewards.lifecycle.pricing.
-- maxDiscountPct (default 20), tunable from the admin Member Pricing panel.
--
-- Mirrors the live smart_reprice() applied via the Management API.

CREATE OR REPLACE FUNCTION public.smart_reprice()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg  public.pricing_config;
  v_deep numeric;
  v_maxdisc numeric;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;
  -- Cap: no price (shelf, bulk or member) may go more than maxDiscountPct% off MRP.
  v_maxdisc := coalesce((select (rewards->'lifecycle'->'pricing'->>'maxDiscountPct')::numeric
                        from public.settings where id = 1), 20);

  insert into public.product_costs (product_id)
    select id from public.products on conflict (product_id) do nothing;

  with sales as (
    select oi.product_id as pid,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '1 day'),  0)::int as d1,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '3 days'), 0)::int as d3,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '7 days'), 0)::int as d7,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '14 days'),0)::int as d14,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '30 days'),0)::int as d30
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'Cancelled' and o.created_at >= now() - interval '30 days'
    group by oi.product_id
  ),
  scored as (
    select p.id, pc.cost, p.mrp, p.created_at,
      coalesce(s.d1,0) d1, coalesce(s.d3,0) d3, coalesce(s.d7,0) d7,
      coalesce(s.d14,0) d14, coalesce(s.d30,0) d30,
      round(30.0 * (
        4*coalesce(s.d1,0)/1.0 + 3*coalesce(s.d3,0)/3.0 + 3*coalesce(s.d7,0)/7.0
        + 2*coalesce(s.d14,0)/14.0 + 1*coalesce(s.d30,0)/30.0
      ) / 13.0)::int as vscore
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    left join sales s on s.pid = p.id
  ),
  calc as (
    select *,
      case
        when cost is null or mrp is null or mrp < cost then 'unpriced'
        when d30 = 0 and created_at < now() - interval '30 days' then 'dead'
        when d30 between 1 and cfg.slow_max then 'slow'
        when vscore >= cfg.fast_min then 'fast'
        else 'steady'
      end as tier
    from scored
  ),
  priced as (
    select *,
      case tier
        when 'unpriced' then null
        when 'dead'   then round(cost * (1 + cfg.clearance_markup))
        when 'fast'   then round(cost / (1 - cfg.fast_margin))
        when 'slow'   then round(cost / (1 - cfg.slow_margin))
        else               round(cost / (1 - cfg.steady_margin))
      end as raw
    from calc
  ),
  priv as (
    update public.product_costs pc set
      speed_tier = pr.tier, units_30d = pr.d30, velocity_score = pr.vscore,
      sold_1d = pr.d1, sold_3d = pr.d3, sold_7d = pr.d7, sold_14d = pr.d14, sold_30d = pr.d30
    from priced pr where pc.product_id = pr.id
    returning pr.id, pr.tier, pr.raw, pr.cost, pr.mrp, pr.vscore
  )
  update public.products p set
    price = case when priv.tier = 'unpriced' then p.price
                 else least(greatest(least(priv.raw, priv.mrp), greatest(ceil(priv.cost * (1 + cfg.floor_markup)), ceil(priv.mrp * (1 - v_maxdisc / 100)))), priv.mrp)
            end,
    hot = (priv.vscore >= cfg.fast_min),
    auto_priced_at = case when priv.tier = 'unpriced' then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  update public.products p set
    bulk_tiers = public.build_bulk_tiers(p.price, greatest(ceil(pc.cost * (1 + cfg.floor_markup)), ceil(p.mrp * (1 - v_maxdisc / 100))), cfg)
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced');

  update public.products set bait = false where bait;
  update public.products p set bait = true
    from public.product_costs pc where pc.product_id = p.id and pc.bait_override = 'pin';
  with cand as (
    select pc.product_id from public.product_costs pc
    join public.products p on p.id = pc.product_id
    where pc.speed_tier = 'fast' and p.active and coalesce(pc.bait_override, '') <> 'hide'
    order by pc.velocity_score desc, pc.units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.product_id;

  -- Tier pricing anchor: the deepest price any member can ever pay (cost + a
  -- minimum margin) — so no item ever sells at a loss. Public by design: it is
  -- literally the price shown to a brand-new Prime member.
  v_deep := coalesce((select (rewards->'lifecycle'->'pricing'->>'deepMarginPct')::numeric
                        from public.settings where id = 1), 7);
  update public.products p set
    member_price_floor = case
      when pc.cost is null or p.mrp is null or pc.speed_tier = 'unpriced' then null
      else least(p.mrp, greatest(
             ceil(pc.cost * (1 + v_deep / 100)),
             ceil(p.mrp * (1 - v_maxdisc / 100))
           )) end
    from public.product_costs pc where pc.product_id = p.id;

  -- Mode A/B is retired — tier pricing replaces it. Neutralize the old factors.
  update public.products set member_factor = 1.0, member_bonus_kind = null
    where member_factor <> 1.0 or member_bonus_kind is not null;
end; $function$


-- Ensure the cap is set, then recompute every product's prices/floors.
update public.settings
set rewards = jsonb_set(rewards, '{lifecycle,pricing,maxDiscountPct}', '20'::jsonb, true)
where id = 1;

select public.smart_reprice();
