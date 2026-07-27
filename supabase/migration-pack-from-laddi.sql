-- Pack sizes come from the laddi, not from the price.
--
-- The owner explained what he was actually doing, and it is a better model than
-- the one I built:
--
--   "biscuits and namkeen have packs that I buy — a biscuit laddi has 12 pieces,
--    namkeen the same, that's why 1, 6, 12. But some products have 10 in a
--    packet, that's why 1, 5, 10."
--
-- The quantity that matters is a PHYSICAL FACT about the product, not a band of
-- rupees. A laddi of twelve is what the distributor delivers, what sits on the
-- shelf, and what the shop can hand over sealed without counting anything out.
-- Half a laddi and a whole laddi are the two amounts a person actually asks for.
--
-- The proof that the price band was the wrong axis: he had already typed {6,12}
-- by hand on TWELVE products — every biscuit in the shop — because they all come
-- twelve to a laddi. Twelve identical entries is a system making a person do its
-- job. He states the laddi size once and the ladder follows:
--
--     laddi of 12  →  6, 12          laddi of 10  →  5, 10
--     laddi of 24  →  6, 12, 24      laddi of 15  →  5, 15
--
-- The margin rules are unchanged and still decide what survives: a step is only
-- offered if it beats the one before it, so a thin item still shows one pack and
-- an item with no room shows none.
--
-- Order of precedence, most specific first:
--   1. by hand      the owner set quantities AND prices; nothing touches them
--   2. my sizes     an explicit list he typed for this one product
--   3. the laddi    stated once, ladder derived from it        <- this migration
--   4. the price    the fallback ladder, for anything unstated

begin;

alter table public.products
  add column if not exists case_size int;

comment on column public.products.case_size is
  'How many pieces come in one laddi / outer packet, as bought from the distributor. Drives the automatic pack sizes: a 12 gives 6 and 12.';

-- Half a laddi and a whole laddi — the two amounts people ask for. A big laddi
-- gets a quarter step as well, because 24 in one go is a lot to start at.
create or replace function public.qtys_from_case(case_size int)
returns int[]
language sql immutable
as $$
  select case
    when case_size is null or case_size < 3 then null
    when case_size >= 20 and case_size % 4 = 0 then array[case_size/4, case_size/2, case_size]
    when case_size % 2 = 0 then array[case_size/2, case_size]
    -- An odd laddi splits into thirds more naturally than halves: 15 → 5 and 15.
    when case_size % 3 = 0 then array[case_size/3, case_size]
    else array[case_size]
  end
$$;

-- Which quantities to try for this product: the laddi if it is known, otherwise
-- the price ladder.
create or replace function public.bulk_qtys_for(p public.products, cfg public.pricing_config)
returns int[]
language sql immutable
as $$
  select coalesce(public.qtys_from_case(p.case_size),
                  public.bulk_qtys_for_price(p.price, cfg))
$$;

-- A LADDI IS A PHYSICAL UNIT, so both steps of it are worth showing: half a
-- laddi and a whole one, even when the margin only funds a discount on the
-- first. Somebody asking for a full sealed laddi should be able to tap it.
--
-- But that must not resurrect pointless packs on a product with no room at all.
-- So the rule is all-or-nothing: if not one step earned a discount, the ladder
-- is dropped entirely — which is what happens on milk, exactly as before.
create or replace function public.build_bulk_tiers_from_case(base numeric, cost numeric,
                                                             floor_price numeric,
                                                             cfg public.pricing_config,
                                                             qtys int[])
returns jsonb
language plpgsql immutable
as $$
declare t jsonb; e jsonb; any_saving boolean := false;
begin
  t := public.build_bulk_tiers_at(base, cost, floor_price, cfg, qtys, true);
  for e in select * from jsonb_array_elements(t) loop
    if (e->>'price')::numeric < base then any_saving := true; end if;
  end loop;
  return case when any_saving then t else '[]'::jsonb end;
end $$;

-- The two triggers that reprice the moment a price or a cost is saved must use
-- the same ladder as the scheduled run, or the packs would change shape a few
-- hours after the owner pressed Save.
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
          or new.case_size is distinct from old.case_size
          or new.price     is distinct from old.price) then
    select * into cfg from public.pricing_config where id = 1;
    select cost into v_cost from public.product_costs where product_id = new.id;
    if cfg is null or v_cost is null or new.price is null then
      new.bulk_tiers := '[]'::jsonb;
    elsif new.bulk_mode = 'qty' then
      new.bulk_tiers := public.build_bulk_tiers_at(new.price, v_cost,
                          v_cost * (1 + cfg.floor_markup), cfg, new.bulk_qtys);
    else
      new.bulk_tiers := case when new.case_size is not null
        then public.build_bulk_tiers_from_case(new.price, v_cost,
               v_cost * (1 + cfg.floor_markup), cfg, public.bulk_qtys_for(new, cfg))
        else public.build_bulk_tiers_at(new.price, v_cost,
               v_cost * (1 + cfg.floor_markup), cfg, public.bulk_qtys_for(new, cfg), false) end;
    end if;
  end if;
  return new;
end $$;

create or replace function public.product_costs_bulk_sync()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.pricing_config; p public.products;
begin
  if tg_op = 'UPDATE' and new.cost is not distinct from old.cost then return null; end if;
  select * into cfg from public.pricing_config where id = 1;
  select * into p from public.products where id = new.product_id;
  if p.id is null or p.bulk_mode = 'manual' then return null; end if;
  update public.products x set bulk_tiers = case
      when cfg is null or new.cost is null or p.price is null then '[]'::jsonb
      when p.bulk_mode = 'qty' then public.build_bulk_tiers_at(p.price, new.cost,
             new.cost * (1 + cfg.floor_markup), cfg, p.bulk_qtys)
      when p.case_size is not null then public.build_bulk_tiers_from_case(p.price, new.cost,
             new.cost * (1 + cfg.floor_markup), cfg, public.bulk_qtys_for(p, cfg))
      else public.build_bulk_tiers_at(p.price, new.cost,
             new.cost * (1 + cfg.floor_markup), cfg,
             public.bulk_qtys_for(p, cfg), false) end
   where x.id = new.product_id;
  return null;
end $$;

commit;

-- Every biscuit in the shop is twelve to a laddi, which is why the same {6,12}
-- was typed onto all twelve of them. Record the fact, so the ladder holds even
-- if the explicit list is later cleared.
update public.products
   set case_size = (select max(q) from unnest(bulk_qtys) q)
 where bulk_mode = 'qty' and case_size is null
   and array_length(bulk_qtys, 1) > 0;
