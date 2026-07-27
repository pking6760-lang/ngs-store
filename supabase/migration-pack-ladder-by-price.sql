-- How many packs, and how big, decided by the price and the room to discount.
--
-- Fortune Mustard Oil, ₹195, was offering Pack of 2, 3 AND 4 — ₹772 for four
-- bottles — and all three at the same ₹193. Two things wrong at once, and the
-- owner named both:
--
--   "if the MRP is low you can give 10, 15, 16 type packs, but if MRP is high
--    then 1 2 3. If we don't have margin to give that much discount then just
--    two packs. If there is no margin, no bulk pack."
--
-- 1. THE QUANTITIES WERE FIXED AT 2/3/4 FOR EVERYTHING. That is nonsense at both
--    ends. Nobody takes four bottles of mustard oil from a kirana; equally, a ₹5
--    biscuit sold in twos is not a bulk pack, it is a rounding error. What a
--    person buys at once tracks the price of the thing.
--
-- 2. TIERS WERE KEPT EVEN WHEN THEY REPEATED THE PREVIOUS PRICE. That oil costs
--    ₹185 and sells at ₹195, so cost + 4% leaves ₹2.60 of room in total — one
--    tier's worth. Packs 3 and 4 asked the customer to commit more money for
--    exactly nothing.
--
-- So the ladder now comes from the price, in the owner's own shapes — clean
-- multiples a person actually counts in:
--
--     1, 5, 10        under ₹15    biscuits, sachets, small snacks
--     1, 4, 8, 12     under ₹40
--     1, 3, 6, 9      under ₹100
--     1, 2, 3, 4      above that   oil, big packs
--
-- and it STOPS the moment a bigger pack cannot beat the one before it. So thin
-- margin produces one pack, NO margin produces no packs at all, and only a
-- product with real room shows the full ladder. The ladder is configuration
-- rather than code, because the right quantities are a shopkeeper's judgement
-- and will change as the shop learns.

begin;

alter table public.pricing_config
  add column if not exists bulk_ladder jsonb not null default '[
    {"maxPrice": 15,   "qtys": [5, 10]},
    {"maxPrice": 40,   "qtys": [4, 8, 12]},
    {"maxPrice": 100,  "qtys": [3, 6, 9]},
    {"maxPrice": null, "qtys": [2, 3, 4]}
  ]'::jsonb;

comment on column public.pricing_config.bulk_ladder is
  'Pack quantities to try, by selling price. Cheap things are bought by the dozen; expensive things two at a time. The engine still stops early when the margin cannot fund another step.';

-- The quantities to try for a product at this price.
create or replace function public.bulk_qtys_for_price(base numeric, cfg public.pricing_config)
returns int[]
language plpgsql immutable
as $$
declare band jsonb; v int[];
begin
  for band in select * from jsonb_array_elements(coalesce(cfg.bulk_ladder, '[]'::jsonb)) loop
    if band->>'maxPrice' is null or base <= (band->>'maxPrice')::numeric then
      select array_agg((q)::int order by (q)::int)
        into v from jsonb_array_elements_text(band->'qtys') q;
      return coalesce(v, '{}');
    end if;
  end loop;
  return array[2, 3, 4];   -- no ladder configured: the old behaviour
end $$;

create or replace function public.build_bulk_tiers_at(base numeric, cost numeric,
                                                      floor_price numeric,
                                                      cfg public.pricing_config,
                                                      qtys int[],
                                                      keep_flat boolean default true)
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
  -- No buying price means no cost floor, and without a floor this would happily
  -- price down to the configured discount on a product whose margin nobody
  -- knows. Refuse rather than guess.
  if base is null or cost is null or qtys is null or array_length(qtys, 1) is null then
    return '[]'::jsonb;
  end if;

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
    p_conf   := round(base * (1 - off));                    -- the discount you configured
    p_afford := base - (share * (q - 1) * (base - c)) / q;  -- share of the extra profit
    p_floor  := coalesce(floor_price, 0);                   -- never below cost + markup
    p_prev   := c + prev_profit / q;                        -- never earn less than the smaller pack
    want     := greatest(p_afford, p_floor, p_prev);

    -- Whole rupees first, because ₹55 reads better than ₹55.25 and that is what
    -- the shop has always shown. Only when no whole-rupee price can beat the
    -- shelf price do we allow quarters.
    p := greatest(p_conf, ceil(want));
    if p >= base then
      p := greatest(p_conf, public.round_up_25(want));
      if p >= base then p := base; end if;   -- genuinely nothing to give
    end if;

    -- STOP when a bigger pack cannot beat the one before it. The cost floor only
    -- ever rises from here, so no larger quantity will do better either — and
    -- asking a customer to commit more money for the same price is not an offer,
    -- it is a worse deal dressed as a bigger one.
    --
    -- The owner's OWN sizes are the exception: if he asked for a six and a dozen
    -- deliberately, both are offered whether or not a discount is attached,
    -- because a dozen in one tap is a convenience in itself.
    if p >= last then
      if not keep_flat then exit; end if;
      p := last;
    end if;

    tiers := tiers || jsonb_build_object('q', q, 'price', p);
    last := p; prev_q := q; prev_profit := q * (p - c);
  end loop;
  return tiers;
end $$;

-- The engine's own quantities: chosen from the price, not the same 2/3/4 for a
-- ₹5 biscuit and a ₹195 bottle of oil.
create or replace function public.build_bulk_tiers(base numeric, cost numeric,
                                                   floor_price numeric,
                                                   cfg public.pricing_config)
returns jsonb
language sql immutable
as $$
  select public.build_bulk_tiers_at(base, cost, floor_price, cfg,
                                    public.bulk_qtys_for_price(base, cfg), false)
$$;

commit;
