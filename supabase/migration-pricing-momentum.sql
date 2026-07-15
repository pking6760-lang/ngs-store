-- Smart Pricing v2 — momentum, not a flat 30-day average.
--
-- Instead of one 30-day count, look at 1d / 3d / 7d / 14d / 30d windows, turn
-- each into a per-day rate, and weight the recent windows more heavily. A
-- product that just started selling fast gets promoted this week; one that's
-- gone quiet cools off — without waiting for a month's average to move.
--
--   velocity_score (monthly pace) = round( 30 * weighted_daily_rate )
--   weights (recent → old): 1d:4  3d:3  7d:3  14d:2  30d:1   (sum 13)
--
-- Tiers: recent momentum drives the fast/steady line; total 30-day volume
-- drives the slow/dead floor.

alter table public.products add column if not exists sold_1d  integer default 0;
alter table public.products add column if not exists sold_3d  integer default 0;
alter table public.products add column if not exists sold_7d  integer default 0;
alter table public.products add column if not exists sold_14d integer default 0;
alter table public.products add column if not exists sold_30d integer default 0;
alter table public.products add column if not exists velocity_score integer default 0;

create or replace function public.smart_reprice()
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.pricing_config;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

  with sales as (   -- cumulative units sold per product in each window
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
  )
  update public.products p set
    sold_1d = pr.d1, sold_3d = pr.d3, sold_7d = pr.d7, sold_14d = pr.d14, sold_30d = pr.d30,
    units_30d = pr.d30, velocity_score = pr.vscore,
    speed_tier = pr.tier,
    price = case when pr.tier = 'unpriced' then p.price
                 else least(greatest(least(pr.raw, pr.mrp), ceil(pr.cost * (1 + cfg.floor_markup))), pr.mrp)
            end,
    auto_priced_at = case when pr.tier = 'unpriced' then p.auto_priced_at else now() end
  from priced pr
  where p.id = pr.id;

  update public.products set bait = false;
  update public.products set bait = true where bait_override = 'pin';
  with cand as (
    select id from public.products
    where speed_tier = 'fast' and active and coalesce(bait_override, '') <> 'hide'
    order by velocity_score desc, units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.id;
end; $$;
