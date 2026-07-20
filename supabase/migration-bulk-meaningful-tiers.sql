-- ════════════════════════════════════════════════════════════════════════════
-- Bulk tiers: only offer a pack when it's a MEANINGFUL per-unit discount.
-- With the profit floor, a thin-margin item's later tiers can only inch down ₹1
-- (e.g. Fortune Oil ₹105 → 100 → 99 → 98). A ₹1-off "deal" isn't a deal and the
-- curve looks odd, so a tier is now kept only if it's at least ~3% of base (min
-- ₹2) cheaper per unit than the previous shown tier. Thin-margin products get
-- fewer / no bulk tiers — correctly; healthy-margin products keep a full curve.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.build_bulk_tiers(base numeric, cost numeric, floor_price numeric, cfg public.pricing_config)
 returns jsonb language plpgsql immutable as $function$
declare
  tiers jsonb := '[]'::jsonb;
  last numeric := base;
  prev_q int := 1;
  c numeric := coalesce(cost, 0);
  prev_profit numeric := base - coalesce(cost, 0);            -- profit on one unit
  step_min numeric := greatest(round(base * 0.03), 2);        -- a tier must save >= this per unit vs the previous, else it's not a real deal
  mins int[] := array[cfg.bulk_min_1, cfg.bulk_min_2, cfg.bulk_min_3];
  offs numeric[] := array[cfg.bulk_off_1, cfg.bulk_off_2, cfg.bulk_off_3];
  i int; q int; off numeric; p numeric;
begin
  if base is null or not cfg.bulk_enabled then return '[]'::jsonb; end if;
  for i in 1..3 loop
    q := mins[i]; off := offs[i];
    if q is null or q <= prev_q then continue; end if;
    -- Configured discount, but never below the cost floor, and never so low the
    -- whole pack earns less total profit than the previous tier.
    p := greatest(round(base * (1 - coalesce(off, 0))), floor_price, ceil(c + prev_profit / q));
    -- Skip unless it's a genuinely meaningful step down per unit.
    if p > last - step_min then continue; end if;
    tiers := tiers || jsonb_build_object('q', q, 'price', p);
    last := p; prev_q := q; prev_profit := q * (p - c);
  end loop;
  return tiers;
end $function$;

select public.smart_reprice();
