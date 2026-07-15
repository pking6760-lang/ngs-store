-- Buying price is commercially sensitive and must never reach customers, but
-- the products table is publicly readable. Move `cost` into an admin-only side
-- table so it's simply not part of the public product payload. smart_reprice
-- (security definer) still reads it to compute selling prices.

create table if not exists public.product_costs (
  product_id text primary key references public.products(id) on delete cascade,
  cost numeric(10,2) check (cost is null or cost >= 0)
);

-- carry over anything already set on products.cost
insert into public.product_costs (product_id, cost)
  select id, cost from public.products where cost is not null
  on conflict (product_id) do update set cost = excluded.cost;

alter table public.product_costs enable row level security;
drop policy if exists product_costs_admin on public.product_costs;
create policy product_costs_admin on public.product_costs
  for all using (public.is_admin()) with check (public.is_admin());

-- cost no longer lives on the public table
alter table public.products drop column if exists cost;

-- Re-point the pricing engine at product_costs.
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
    select p.id, pc.cost, p.mrp, coalesce(v.u, 0) as u,
      case
        when pc.cost is null or p.mrp is null or not p.active or p.mrp < pc.cost then 'unpriced'
        when coalesce(v.u, 0) >= cfg.fast_min then 'fast'
        when coalesce(v.u, 0) = 0
             and p.created_at < now() - (cfg.window_days || ' days')::interval then 'dead'
        when coalesce(v.u, 0) between 1 and cfg.slow_max then 'slow'
        else 'steady'
      end as tier
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
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
    order by units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.id;
end; $$;
