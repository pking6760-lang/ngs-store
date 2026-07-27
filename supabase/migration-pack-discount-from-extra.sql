-- Give a real discount on a pack, out of the extra profit the pack creates.
--
-- THE PROBLEM, in the owner's words: "on one pack we are not giving any discount
-- but they are buying more, the margin is increasing, so we can give some
-- discount — not much, but still."
--
-- He is right, and the reason it wasn't happening is arithmetic, not principle.
-- Every bulk price was rounded to a whole rupee and floored at cost + 4%:
--
--     Britannia BOURBON   sells 10.00   costs 8.86   floor = ceil(9.21) = 10
--
-- The floor rounded up to exactly the selling price, so no discount could exist.
-- The engine did the only honest thing available to it and offered the pack at
-- full price. The whole-rupee rounding was the cage.
--
-- Two changes:
--
-- 1. WHEN — AND ONLY WHEN — a whole-rupee discount is impossible, prices may
--    step in 25 paise. On the Bourbon that turns "no discount" into 9.75 a unit:
--    ₹58.50 for six instead of ₹60. Items that already get a whole-rupee
--    discount are untouched, so nothing that works today changes.
--
-- 2. The discount is capped at a share of the EXTRA profit the bigger pack
--    creates, never dipping into the profit a single would have made:
--
--        extra profit  = (q - 1) x (price - cost)
--        most we give  = extra profit x bulk_give_share
--
--    On the Bourbon: six units earn ₹6.84 against ₹1.14 for one, so the extra is
--    ₹5.70 and we hand back ₹1.50 of it. The shop keeps ₹5.34 — still nearly
--    five times what selling a single earns, on the same trip and the same
--    picking. That is the whole case for the pack.
--
-- The cap is set so it does NOT tighten the discounts already being given on
-- healthy-margin items: at 40%, a ₹60 item on ₹16.67 of margin keeps exactly the
-- price it has today. It only binds where the margin is genuinely thin, which is
-- exactly where care is needed.

begin;

alter table public.pricing_config
  add column if not exists bulk_give_share numeric not null default 0.40;

comment on column public.pricing_config.bulk_give_share is
  'Most of the EXTRA profit a bigger pack creates that may be handed back as a discount. 0.40 = keep at least 60% of the gain. Raise it to push volume, lower it to protect margin.';

-- Round up to the nearest 25 paise. Up, because rounding a price DOWN gives
-- money away by accident, and 0.25 because quarter-rupees are exact in binary
-- floating point — a pack price of 9.75 x 6 is 58.50 on every device, not
-- 58.499999.
create or replace function public.round_up_25(v numeric)
returns numeric language sql immutable as $$
  select ceil(v * 4) / 4.0
$$;

-- The bulk ladder at the owner's own quantities.
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
  share numeric := coalesce(cfg.bulk_give_share, 0.40);
  offs numeric[] := array[cfg.bulk_off_1, cfg.bulk_off_2, cfg.bulk_off_3];
  i int; q int; off numeric;
  p_conf numeric; p_afford numeric; p_prev numeric; p_floor numeric;
  want numeric; p numeric;
begin
  if base is null or qtys is null or array_length(qtys, 1) is null then return '[]'::jsonb; end if;

  for i in 1..array_length(qtys, 1) loop
    q := qtys[i];
    continue when q is null or q <= prev_q;
    -- Beyond the third step the deepest configured discount just repeats.
    off := coalesce(offs[least(i, 3)], 0);

    -- Four prices, and the HIGHEST of them wins — each one is a reason the
    -- discount cannot be any deeper than it is.
    -- The configured discount is rounded to a whole rupee the way it always has
    -- been. The other three are hard lower bounds and are only ever rounded UP,
    -- because rounding a limit downwards is how a limit stops being one.
    p_conf   := round(base * (1 - off));                -- the discount you configured
    p_afford := base - (share * (q - 1) * (base - c)) / q;  -- share of the extra profit
    p_floor  := coalesce(floor_price, 0);               -- never below cost + markup
    p_prev   := c + prev_profit / q;                    -- never earn less than the smaller pack
    want     := greatest(p_afford, p_floor, p_prev);

    -- Whole rupees first, because ₹55 reads better than ₹55.25 and that is what
    -- the shop has always shown. Only when no whole-rupee price can beat the
    -- shelf price do we allow quarters — that is the case this exists to unlock,
    -- and it must not disturb the case that already works.
    p := greatest(p_conf, ceil(want));
    if p >= base then
      p := greatest(p_conf, public.round_up_25(want));
      if p >= base then p := base; end if;   -- genuinely nothing to give
    end if;

    -- A tier has to be a real step down, or it is the same offer twice. If it
    -- isn't, the pack is still OFFERED at the previous price: the owner asked
    -- for a six and a dozen deliberately, and six on one line earns six times
    -- what a single does whether or not a discount is attached.
    if p > last then p := last; end if;

    tiers := tiers || jsonb_build_object('q', q, 'price', p);
    last := p; prev_q := q; prev_profit := q * (p - c);
  end loop;
  return tiers;
end $$;

-- The same rule for the engine's own 2/3/4 quantities, so a product does not
-- get a different deal purely because of which mode it is in.
create or replace function public.build_bulk_tiers(base numeric, cost numeric,
                                                   floor_price numeric,
                                                   cfg public.pricing_config)
returns jsonb
language sql immutable
as $$
  select public.build_bulk_tiers_at(base, cost, floor_price, cfg, array[2, 3, 4])
$$;

-- Every caller must now hand over the EXACT cost floor. Rounding it up to a
-- whole rupee first is precisely what made a discount impossible on a ₹10 item:
-- 8.86 plus 4% is 9.21, and ceil() turned that into 10 — the shelf price itself.
-- The SHELF price stays in whole rupees; only the pack floor keeps its paise.
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
  if v_price is null or v_price <= 0 or v_cost is null or v_cost < 0 then return '[]'::jsonb; end if;
  return public.build_bulk_tiers_at(v_price, v_cost,
           v_cost * (1 + coalesce(cfg.floor_markup, 0.04)), cfg, p_qtys);
end $$;

revoke all on function public.preview_bulk_tiers(text, int[], numeric, numeric) from public, anon;
grant execute on function public.preview_bulk_tiers(text, int[], numeric, numeric) to authenticated;

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
                          v_cost * (1 + cfg.floor_markup), cfg, new.bulk_qtys);
    else
      new.bulk_tiers := public.build_bulk_tiers(new.price, v_cost,
                          v_cost * (1 + cfg.floor_markup), cfg);
    end if;
  end if;
  return new;
end $$;

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
             new.cost * (1 + cfg.floor_markup), cfg, p.bulk_qtys)
      else public.build_bulk_tiers(p.price, new.cost,
             new.cost * (1 + cfg.floor_markup), cfg) end
   where p.id = new.product_id and p.bulk_mode <> 'manual';
  return null;
end $$;

commit;
