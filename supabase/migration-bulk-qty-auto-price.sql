-- Pack sizes by hand, prices by machine.
--
-- There were only two modes and neither is what a shopkeeper wants:
--   auto    2/3/4 units, priced automatically -- the quantities are wrong
--           (nobody buys three biscuits; they buy six or a dozen)
--   manual  the owner types the quantities AND every price, then has to retype
--           them all whenever a buying cost moves
--
-- The third mode is the useful one: the owner knows the pack sizes (1/6/12),
-- the engine knows what each one can be sold for. Prices then follow cost
-- automatically, exactly like normal prices already do.
--
-- The pricing rule is the existing bulk ladder applied at the owner's
-- quantities, and floored at cost + markup. That floor matters more than it
-- looks: a Rs10 biscuit costing Rs8.86 has a floor of Rs10, so the automation
-- correctly produces NO discount for it. That's the right answer -- these items
-- can't fund one -- and the pack is still worth selling, because six units on
-- one line earn Rs6.84 against Rs1.14 for a single and cost the same to deliver.

begin;

alter table public.products
  add column if not exists bulk_mode text not null default 'auto',
  add column if not exists bulk_qtys int[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_bulk_mode_ck') then
    alter table public.products add constraint products_bulk_mode_ck
      check (bulk_mode in ('auto', 'qty', 'manual'));
  end if;
end $$;

comment on column public.products.bulk_mode is
  'auto = engine picks quantities and prices; qty = owner picks quantities, engine prices them; manual = owner sets both and the engine never touches them.';
comment on column public.products.bulk_qtys is
  'Owner-chosen pack quantities for bulk_mode=qty, e.g. {6,12}.';

-- Carry the old boolean over: manual_bulk meant "owner set everything".
update public.products set bulk_mode = 'manual'
 where coalesce(manual_bulk, false) and bulk_mode = 'auto';

-- Two columns now describe the same thing, and an admin app already installed on
-- a phone only knows the old one. So the database keeps them in step itself
-- rather than trusting whatever the client sent: an old build toggling
-- manual_bulk still lands on the right mode, and a new build setting bulk_mode
-- still leaves the boolean correct for anything that reads it.
--
-- The quantities are normalised here too, because build_bulk_tiers_at walks the
-- array in order and drops anything not larger than the last one — an unsorted
-- {12,6} would silently lose the six. Cleaned once, on the way in.
create or replace function public.products_bulk_sync()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.pricing_config; v_cost numeric;
begin
  if tg_op = 'UPDATE'
     and new.bulk_mode is not distinct from old.bulk_mode
     and new.manual_bulk is distinct from old.manual_bulk then
    new.bulk_mode := case when new.manual_bulk then 'manual'
                          when old.bulk_mode = 'manual' then 'auto'
                          else old.bulk_mode end;
  end if;
  new.manual_bulk := (new.bulk_mode = 'manual');
  select coalesce(array_agg(q order by q), '{}')
    into new.bulk_qtys
    from (select distinct q from unnest(coalesce(new.bulk_qtys, '{}')) q
           where q > 1 and q <= 500 order by q limit 6) s;

  -- Reprice the packs here and now when the owner changes the sizes, the mode or
  -- the price. The repricer would do it anyway, but only every few hours, and in
  -- between the shop would still be selling yesterday's packs -- the owner presses
  -- Save, looks at the app, and sees nothing happen.
  if tg_op = 'UPDATE'
     and new.bulk_mode <> 'manual'
     and new.bulk_tiers is not distinct from old.bulk_tiers
     and (new.bulk_mode is distinct from old.bulk_mode
          or new.bulk_qtys is distinct from old.bulk_qtys
          or new.price   is distinct from old.price) then
    select * into cfg from public.pricing_config where id = 1;
    select cost into v_cost from public.product_costs where product_id = new.id;
    if cfg is null or v_cost is null or new.price is null then
      new.bulk_tiers := '[]'::jsonb;
    elsif new.bulk_mode = 'qty' then
      new.bulk_tiers := public.build_bulk_tiers_at(new.price, v_cost,
                          ceil(v_cost * (1 + cfg.floor_markup)), cfg, new.bulk_qtys);
    else
      new.bulk_tiers := public.build_bulk_tiers(new.price, v_cost,
                          ceil(v_cost * (1 + cfg.floor_markup)), cfg);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_products_bulk_sync on public.products;
create trigger trg_products_bulk_sync
  before insert or update on public.products
  for each row execute function public.products_bulk_sync();

-- The other half of the same promise. Automatic pack prices are built from the
-- buying cost, so the moment the cost is entered or changed the packs are stale.
-- This is also the path a BRAND NEW product takes: the row is created first and
-- the cost lands a moment later, so without this its packs would stay empty
-- until the next repricing run.
create or replace function public.product_costs_bulk_sync()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.pricing_config;
begin
  if tg_op = 'UPDATE' and new.cost is not distinct from old.cost then return null; end if;
  select * into cfg from public.pricing_config where id = 1;
  update public.products p set bulk_tiers = case
      when cfg is null or new.cost is null or p.price is null then '[]'::jsonb
      when p.bulk_mode = 'qty' then public.build_bulk_tiers_at(p.price, new.cost,
             ceil(new.cost * (1 + cfg.floor_markup)), cfg, p.bulk_qtys)
      else public.build_bulk_tiers(p.price, new.cost,
             ceil(new.cost * (1 + cfg.floor_markup)), cfg) end
   where p.id = new.product_id and p.bulk_mode <> 'manual';
  return null;
end $$;

drop trigger if exists trg_product_costs_bulk_sync on public.product_costs;
create trigger trg_product_costs_bulk_sync
  after insert or update of cost on public.product_costs
  for each row execute function public.product_costs_bulk_sync();

-- The bulk ladder applied at quantities the OWNER chose, rather than the
-- engine's own 2/3/4. Same discounts, same cost floor, same rule that a tier
-- must be a real step down or it isn't offered at all.
create or replace function public.build_bulk_tiers_at(base numeric, cost numeric,
                                                      floor_price numeric,
                                                      cfg public.pricing_config,
                                                      qtys int[])
returns jsonb
language plpgsql immutable
as $$
declare
  tiers jsonb := '[]'::jsonb;
  last numeric := base;
  prev_q int := 1;
  c numeric := coalesce(cost, 0);
  prev_profit numeric := base - coalesce(cost, 0);
  step_min numeric := greatest(round(base * 0.03), 1);
  offs numeric[] := array[cfg.bulk_off_1, cfg.bulk_off_2, cfg.bulk_off_3];
  i int; q int; off numeric; p numeric;
begin
  if base is null or qtys is null or array_length(qtys, 1) is null then return '[]'::jsonb; end if;
  for i in 1..array_length(qtys, 1) loop
    q := qtys[i];
    continue when q is null or q <= prev_q;
    -- Beyond the third step the deepest configured discount just repeats.
    off := coalesce(offs[least(i, 3)], 0);
    -- Configured discount, but never below the cost floor, and never so low that
    -- the whole pack earns less than the previous tier did.
    p := greatest(round(base * (1 - off)), floor_price, ceil(c + prev_profit / q));
    -- If no real discount is affordable, still OFFER the pack at the full price
    -- rather than dropping it. The owner asked for a 6 and a 12 deliberately,
    -- and on a Rs10 biscuit the pack IS the win without any discount: six units
    -- on one line earn Rs6.84 against Rs1.14 for a single and cost the same to
    -- pick and deliver. Silently returning no pack would look broken.
    if p > last - step_min then p := last; end if;
    tiers := tiers || jsonb_build_object('q', q, 'price', p);
    last := p; prev_q := q; prev_profit := q * (p - c);
  end loop;
  return tiers;
end $$;

-- Live preview for the admin editor, so the owner sees what the automation will
-- do before saving rather than discovering it hours later.
--
-- Price and cost can be passed in, because in the editor they are usually being
-- typed at that moment: previewing against the SAVED price would show tiers for
-- a price that is about to change. Omitted, they fall back to what's stored.
drop function if exists public.preview_bulk_tiers(text, int[]);
create or replace function public.preview_bulk_tiers(p_product text, p_qtys int[],
                                                     p_price numeric default null,
                                                     p_cost numeric default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare cfg public.pricing_config; v_p public.products;
        v_cost numeric; v_price numeric;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into cfg from public.pricing_config where id = 1;
  select * into v_p from public.products where id = p_product;
  select cost into v_cost from public.product_costs where product_id = p_product;
  v_price := coalesce(p_price, v_p.price);
  v_cost  := coalesce(p_cost, v_cost);
  -- Without a buying price there is no floor and no margin, so there is nothing
  -- honest to show.
  if v_price is null or v_price <= 0 or v_cost is null or v_cost < 0 then return '[]'::jsonb; end if;
  return public.build_bulk_tiers_at(v_price, v_cost,
           ceil(v_cost * (1 + coalesce(cfg.floor_markup, 0.04))), cfg, p_qtys);
end $$;

revoke all on function public.preview_bulk_tiers(text, int[], numeric, numeric) from public, anon;
grant execute on function public.preview_bulk_tiers(text, int[], numeric, numeric) to authenticated;

-- The repricer, in three modes. Recorded here in full because this is the step
-- that makes 'qty' mode actually work: without it the owner's quantities would
-- be stored and never priced.
--
--   auto    engine's own 2/3/4 quantities, priced automatically
--   qty     the OWNER's quantities (6/12), priced automatically -- prices then
--           follow buying cost on their own, with nothing to retype
--   manual  owner set quantities AND prices; the engine must not touch them,
--           or they'd silently vanish at the next run
create or replace function public.smart_reprice()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  cfg  public.pricing_config;
  v_deep numeric;
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
    price = case when priv.tier = 'unpriced' or p.manual_price then p.price
                 else least(greatest(least(priv.raw, priv.mrp), ceil(priv.cost * (1 + cfg.floor_markup))), priv.mrp)
            end,
    auto_priced_at = case when priv.tier = 'unpriced' or p.manual_price then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  -- Bestseller badge: owner override wins, else automatic (sells fast).
  update public.products p set hot = case
      when pc.hot_override = 'pin'  then true
      when pc.hot_override = 'hide' then false
      else coalesce(pc.velocity_score, 0) >= cfg.fast_min
    end
    from public.product_costs pc where pc.product_id = p.id;

  update public.products p set
    bulk_tiers = case
      when p.bulk_mode = 'qty'
        then public.build_bulk_tiers_at(p.price, pc.cost, ceil(pc.cost * (1 + cfg.floor_markup)), cfg, p.bulk_qtys)
      else public.build_bulk_tiers(p.price, pc.cost, ceil(pc.cost * (1 + cfg.floor_markup)), cfg)
    end
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced'
      and p.bulk_mode <> 'manual';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced')
      and p.bulk_mode <> 'manual';

  -- Best Prices flag: pinned + real discount (>=5%) + fast-sellers, minus hidden.
  update public.products set bait = false where bait;
  update public.products p set bait = true
    from public.product_costs pc where pc.product_id = p.id and pc.bait_override = 'pin';
  update public.products p set bait = true
    from public.product_costs pc
    where pc.product_id = p.id and p.active and p.mrp is not null and p.price < p.mrp
      and (p.mrp - p.price)::numeric / nullif(p.mrp, 0) >= 0.05
      and coalesce(pc.bait_override, '') <> 'hide';
  with cand as (
    select pc.product_id from public.product_costs pc
    join public.products p on p.id = pc.product_id
    where pc.speed_tier = 'fast' and p.active and coalesce(pc.bait_override, '') <> 'hide'
    order by pc.velocity_score desc, pc.units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.product_id;

  v_deep := coalesce((select (rewards->'lifecycle'->'pricing'->>'deepMarginPct')::numeric
                        from public.settings where id = 1), 7);
  update public.products p set
    member_price_floor = case
      when pc.cost is null or p.mrp is null or pc.speed_tier = 'unpriced' then null
      else least(p.mrp, ceil(pc.cost * (1 + v_deep / 100))) end
    from public.product_costs pc where pc.product_id = p.id;

  update public.products set member_factor = 1.0, member_bonus_kind = null
    where member_factor <> 1.0 or member_bonus_kind is not null;

end; $$;

commit;
