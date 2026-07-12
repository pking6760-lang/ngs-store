-- ═══════════════════════════════════════════════════════════════════════════
-- NGS Smart Pricing — automatic selling price from cost + MRP + sales velocity.
--
-- The owner enters only buying price (cost) and MRP. This engine sorts every
-- product into a speed tier by how many units sold in the last N days and sets
-- the selling price for that tier's target margin, clamped to [cost+floor, MRP].
-- Fast-sellers get a thin margin and are advertised as "best price" bait; slow
-- sellers get a fatter margin; dead stock gets a clearance markdown. Runs on a
-- schedule (fully automatic) and can be re-run on demand.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Per-product pricing state -----------------------------------------------
alter table public.products add column if not exists speed_tier    text;      -- fast/steady/slow/dead/unpriced
alter table public.products add column if not exists units_30d     integer default 0;
alter table public.products add column if not exists bait          boolean not null default false;   -- shown as advertised deal
alter table public.products add column if not exists bait_override text;        -- null=auto, 'pin'=always bait, 'hide'=never
alter table public.products add column if not exists auto_priced_at timestamptz;

-- 2. Tunable config (single row) ---------------------------------------------
create table if not exists public.pricing_config (
  id               int primary key default 1 check (id = 1),
  enabled          boolean not null default true,
  window_days      int not null default 30,        -- sales window for velocity
  fast_min         int not null default 20,        -- units/window to be "fast"
  slow_max         int not null default 3,         -- units/window at/below = "slow"
  fast_margin      numeric not null default 0.07,  -- margin-on-selling for each tier
  steady_margin    numeric not null default 0.14,
  slow_margin      numeric not null default 0.22,
  clearance_markup numeric not null default 0.05,  -- dead stock: price = cost*(1+this)
  floor_markup     numeric not null default 0.04,  -- never sell below cost*(1+this)
  bait_count       int not null default 6          -- how many fast-sellers to advertise
);
insert into public.pricing_config (id) values (1) on conflict (id) do nothing;

alter table public.pricing_config enable row level security;
drop policy if exists pricing_config_admin_read on public.pricing_config;
drop policy if exists pricing_config_admin_write on public.pricing_config;
create policy pricing_config_admin_read on public.pricing_config for select using (public.is_admin());
create policy pricing_config_admin_write on public.pricing_config for update using (public.is_admin()) with check (public.is_admin());

-- 3. The engine ---------------------------------------------------------------
create or replace function public.smart_reprice()
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.pricing_config;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

  with vel as (          -- units sold per product inside the window
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
    price = case when pr.tier = 'unpriced' then p.price
                 -- clamp: never above MRP, never below cost+floor
                 else least(greatest(least(pr.raw, pr.mrp), ceil(pr.cost * (1 + cfg.floor_markup))), pr.mrp)
            end,
    auto_priced_at = case when pr.tier = 'unpriced' then p.auto_priced_at else now() end
  from priced pr
  where p.id = pr.id;

  -- Bait: pinned products, plus the top fast-sellers, minus anything hidden.
  update public.products set bait = false;
  update public.products set bait = true where bait_override = 'pin';
  with cand as (
    select id from public.products
    where speed_tier = 'fast' and active and coalesce(bait_override, '') <> 'hide'
    order by units_30d desc, (price - cost) asc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.id;
end; $$;

-- Admin can trigger a recompute on demand from the app.
grant execute on function public.smart_reprice() to authenticated;

-- 4. Schedule it (fully automatic) — every 6 hours, and run once now. ---------
select cron.unschedule('ngs-smart-reprice') where exists (
  select 1 from cron.job where jobname = 'ngs-smart-reprice');
select cron.schedule('ngs-smart-reprice', '0 */6 * * *', $$ select public.smart_reprice(); $$);
select public.smart_reprice();
