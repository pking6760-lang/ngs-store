-- Don't offer a pack that isn't an offer.
--
-- Amul Cow Milk was showing "CHOOSE A PACK — Single ₹31, Pack of 2 ₹62, Pack of
-- 3 ₹93, Pack of 4 ₹124", every row at ₹6.20 per 100 ml. Three extra choices,
-- one extra tap, and nothing whatsoever gained. Worse than nothing: a screen
-- headed "choose a pack" sets up an expectation of a deal that isn't there.
--
-- The rule I had was too broad. It came from a real case -- the owner asking for
-- 1/6/12 on ₹10 biscuits -- where a full-price pack IS worth offering, because
-- somebody wanting a dozen biscuits genuinely wants one tap instead of twelve.
-- That reasoning does not carry to quantities the ENGINE invented. Nobody thinks
-- "I'll take a pack of three milk".
--
-- So the distinction is who chose the quantity:
--
--   owner's own sizes (bulk_mode = 'qty')   a flat pack is still a convenience,
--                                           and it was asked for deliberately
--   engine's own 2/3/4 (bulk_mode = 'auto') a flat pack is noise -- drop it
--
-- On the live catalogue this clears 23 pointless rows across 11 products, and
-- removes the pack sheet entirely from 8 products where nothing was on offer.
-- Milk goes back to a plain ADD button, which is all it ever needed.

begin;

-- The old five-argument version has to go, or a five-argument call becomes
-- ambiguous between it and the new one with a default.
drop function if exists public.build_bulk_tiers_at(numeric, numeric, numeric, public.pricing_config, int[]);

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
    p_conf   := round(base * (1 - off));                    -- the discount you configured
    p_afford := base - (share * (q - 1) * (base - c)) / q;  -- share of the extra profit
    p_floor  := coalesce(floor_price, 0);                   -- never below cost + markup
    p_prev   := c + prev_profit / q;                        -- never earn less than the smaller pack
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

    -- A tier has to be a real step down, or it is the same offer twice.
    if p > last then p := last; end if;

    -- Nothing to give AND nobody asked for this quantity → don't offer it.
    if p >= base and not keep_flat then
      prev_q := q;
      continue;
    end if;

    tiers := tiers || jsonb_build_object('q', q, 'price', p);
    last := p; prev_q := q; prev_profit := q * (p - c);
  end loop;
  return tiers;
end $$;

-- The engine's own quantities. A pack it invented, at a price that saves
-- nothing, is not worth a customer's attention.
create or replace function public.build_bulk_tiers(base numeric, cost numeric,
                                                   floor_price numeric,
                                                   cfg public.pricing_config)
returns jsonb
language sql immutable
as $$
  select public.build_bulk_tiers_at(base, cost, floor_price, cfg, array[2, 3, 4], false)
$$;

commit;
