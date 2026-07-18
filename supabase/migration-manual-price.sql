-- ════════════════════════════════════════════════════════════════════════════
-- Respect the owner's manually-set selling price.
--   • manual_price = true  → the owner set their own selling price (price < MRP);
--     Smart Pricing must NOT touch it. Bulk tiers start from this price.
--   • manual_price = false → owner left selling price = MRP → opt in to
--     automatic pricing (Smart Pricing sets the price from cost + margin).
-- The admin sets this flag on save (price < mrp ⇒ manual).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists manual_price boolean not null default false;

-- Preserve prices that were clearly set by hand: a selling price below MRP that
-- the auto-engine never touched (auto_priced_at is null) is the owner's price.
update public.products
  set manual_price = true
  where coalesce(manual_price, false) = false
    and auto_priced_at is null
    and price is not null and mrp is not null
    and price > 0 and price < mrp;

-- Smart Pricing: leave manually-priced products' price alone.
create or replace function public.smart_reprice()
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.pricing_config;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

  with vel as (
    select oi.product_id as pid, coalesce(sum(oi.qty), 0)::int as u
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'Cancelled'
      and o.created_at >= now() - (cfg.window_days || ' days')::interval
    group by oi.product_id
  ),
  calc as (
    select p.id, p.cost, p.mrp, coalesce(v.u, 0) as u,
      case
        when p.cost is null or p.mrp is null or not p.active or p.mrp < p.cost then 'unpriced'
        when coalesce(v.u, 0) >= cfg.fast_min then 'fast'
        when coalesce(v.u, 0) = 0
             and p.created_at < now() - (cfg.window_days || ' days')::interval then 'dead'
        when coalesce(v.u, 0) between 1 and cfg.slow_max then 'slow'
        else 'steady'
      end as tier
    from public.products p
    left join vel v on v.pid = p.id
  ),
  priced as (
    select id, cost, mrp, u, tier,
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
    speed_tier = pr.tier,
    units_30d  = pr.u,
    -- Keep the price for 'unpriced' items AND for anything the owner priced by
    -- hand (manual_price). Everything else gets the computed, clamped price.
    price = case when pr.tier = 'unpriced' or p.manual_price then p.price
                 else least(greatest(least(pr.raw, pr.mrp), ceil(pr.cost * (1 + cfg.floor_markup))), pr.mrp)
            end,
    auto_priced_at = case when pr.tier = 'unpriced' or p.manual_price then p.auto_priced_at else now() end
  from priced pr
  where p.id = pr.id;

  -- Bait: pinned products, plus top fast-sellers, minus hidden and manual ones
  -- (owner controls a manual product's price/marketing).
  update public.products set bait = false;
  update public.products set bait = true where bait_override = 'pin';
  with cand as (
    select id from public.products
    where speed_tier = 'fast' and active and not coalesce(manual_price, false)
      and coalesce(bait_override, '') <> 'hide'
    order by units_30d desc, (price - cost) asc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.id;
end; $$;

grant execute on function public.smart_reprice() to authenticated;
