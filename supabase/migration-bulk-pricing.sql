-- ═══════════════════════════════════════════════════════════════════════════
-- Automatic bulk pricing — quantity breaks generated from the same cost/margin
-- rules. Buy more → cheaper per unit, but never below cost + floor. The tiers
-- are computed by smart_reprice and stored on the product (public), and the
-- order is priced with them server-side so the discount can't be spoofed.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.pricing_config add column if not exists bulk_enabled boolean not null default true;
alter table public.pricing_config add column if not exists bulk_min_1 int  not null default 3;
alter table public.pricing_config add column if not exists bulk_off_1 numeric not null default 0.04;
alter table public.pricing_config add column if not exists bulk_min_2 int  not null default 6;
alter table public.pricing_config add column if not exists bulk_off_2 numeric not null default 0.08;
alter table public.pricing_config add column if not exists bulk_min_3 int  not null default 12;
alter table public.pricing_config add column if not exists bulk_off_3 numeric not null default 0.12;

alter table public.products add column if not exists bulk_tiers jsonb not null default '[]'::jsonb;

-- Build the quantity-break list for one product. Each tier trims the base price
-- by its % but is floored at cost+floor and only kept if it actually beats the
-- previous tier — so thin-margin items simply get fewer (or no) breaks.
create or replace function public.build_bulk_tiers(base numeric, floor_price numeric, cfg public.pricing_config)
  returns jsonb language plpgsql immutable as $$
declare tiers jsonb := '[]'::jsonb; last numeric := base; p numeric; prev_q int := 1;
begin
  if base is null or not cfg.bulk_enabled then return '[]'::jsonb; end if;
  if cfg.bulk_min_1 > prev_q then
    p := greatest(round(base * (1 - cfg.bulk_off_1)), floor_price);
    if p < last then tiers := tiers || jsonb_build_object('q', cfg.bulk_min_1, 'price', p); last := p; prev_q := cfg.bulk_min_1; end if;
  end if;
  if cfg.bulk_min_2 > prev_q then
    p := greatest(round(base * (1 - cfg.bulk_off_2)), floor_price);
    if p < last then tiers := tiers || jsonb_build_object('q', cfg.bulk_min_2, 'price', p); last := p; prev_q := cfg.bulk_min_2; end if;
  end if;
  if cfg.bulk_min_3 > prev_q then
    p := greatest(round(base * (1 - cfg.bulk_off_3)), floor_price);
    if p < last then tiers := tiers || jsonb_build_object('q', cfg.bulk_min_3, 'price', p); last := p; prev_q := cfg.bulk_min_3; end if;
  end if;
  return tiers;
end $$;

-- The per-unit price for a given quantity: the lowest tier the qty reaches.
create or replace function public.bulk_unit_price(base numeric, tiers jsonb, qty int)
  returns numeric language plpgsql immutable as $$
declare t jsonb; u numeric := base;
begin
  if tiers is null or jsonb_typeof(tiers) <> 'array' then return base; end if;
  for t in select * from jsonb_array_elements(tiers) loop
    if qty >= (t->>'q')::int then u := (t->>'price')::numeric; end if;
  end loop;
  return u;
end $$;

-- smart_reprice: unchanged pricing/tiering, plus a bulk_tiers step at the end.
create or replace function public.smart_reprice()
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.pricing_config;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

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
                 else least(greatest(least(priv.raw, priv.mrp), ceil(priv.cost * (1 + cfg.floor_markup))), priv.mrp)
            end,
    hot = (priv.vscore >= cfg.fast_min),
    auto_priced_at = case when priv.tier = 'unpriced' then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  -- Bulk tiers from the freshly-set price (priced products only).
  update public.products p set
    bulk_tiers = public.build_bulk_tiers(p.price, ceil(pc.cost * (1 + cfg.floor_markup)), cfg)
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced');

  update public.products set bait = false;
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
end; $$;

select public.smart_reprice();
