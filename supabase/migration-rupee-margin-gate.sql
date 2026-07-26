-- Free-delivery gate: measure margin in RUPEES as well as percent.
--
-- The bug, in one line: percentage margin is meaningless on cheap items.
--
-- Parle Happy Happy is ₹10 at 15.0% margin — a healthier percentage than a
-- ₹500 item at 6% — and earns ₹1.50. Across the catalogue the ₹10-20 band
-- averages 13.9% margin and ₹1.79 a unit, while the ₹200+ band averages 6.3%
-- and ₹29.38. The cheap items score BETTER on the metric the gate uses and
-- worse on the one that pays the rider.
--
-- The gate only checked percent (>= 10%), so 41 of 83 costed products passed it
-- while earning under ₹3 each. Ten such lines make a ₹200 cart that clears the
-- ₹199 free-delivery bar, and:
--
--        distance   fee charged   rider   picker   margin   PAYING FEE   IF FREE
--          0.5 km        ₹20      ₹18     ₹23      ₹28.76     +₹17.76    −₹2.24
--          1.0 km        ₹20      ₹23     ₹23      ₹28.76     +₹12.76    −₹7.24
--          2.0 km        ₹35      ₹39     ₹23      ₹28.76     +₹11.76   −₹23.24
--          3.0 km        ₹50      ₹55     ₹23      ₹28.76     +₹10.76   −₹39.24
--
-- Paying the fee, the cart is comfortably profitable at every distance. Given
-- free delivery it loses at every distance. So the whole defect is that this
-- cart is allowed to unlock free delivery at all — nothing else needs changing.
-- Twenty ₹10 items are also the SLOWEST cart to pick (₹23 of picker time vs ₹5
-- for a single item), which is why they are the worst possible thing to ship free.
--
-- Fix: an item counts toward the free-delivery bar only if its margin clears
-- BOTH a percentage floor and a rupee floor. Nothing about shelf prices changes
-- and nothing is withheld from the customer that they were promised — the cart
-- already reads this same flag (api.js ORs manual + auto), so the "add ₹X more
-- for FREE delivery" bar and the checkout total stay in agreement.

begin;

alter table public.ops_config
  add column if not exists free_delivery_min_margin_rupees numeric not null default 3;

comment on column public.ops_config.free_delivery_min_margin_rupees is
  'Minimum RUPEE margin per unit for an item to count toward the free-delivery bar. Percent alone cannot see that 15% of ₹10 is ₹1.50, which does not pay a rider.';

create or replace function public.refresh_free_delivery_exempt()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_min_pct numeric; v_min_rs numeric;
begin
  select coalesce(free_delivery_min_margin_pct, 10),
         coalesce(free_delivery_min_margin_rupees, 3)
    into v_min_pct, v_min_rs
    from public.ops_config where id = 1;

  update public.products p
     set free_delivery_exempt_auto = v_auto.should_exempt
    from (
      select p2.id,
             -- No cost on file is treated as "counts", not "excluded": guessing
             -- against the customer on missing data would silently withhold free
             -- delivery on items the shop simply hasn't costed yet.
             case when c.cost is null or c.cost <= 0 or p2.price <= 0 then false
                  -- Either floor excludes it. Percent catches the thin-margin
                  -- big-ticket items (oil, atta, tobacco at ~6%); rupees catches
                  -- the ₹10 items whose percentage looks fine and whose cash
                  -- contribution cannot fund a delivery.
                  else ((p2.price - c.cost) / p2.price * 100) < v_min_pct
                    or  (p2.price - c.cost) < v_min_rs
             end as should_exempt
        from public.products p2
        left join public.product_costs c on c.product_id = p2.id
    ) as v_auto
   where p.id = v_auto.id
     and p.free_delivery_exempt_auto is distinct from v_auto.should_exempt;
end;
$$;

select public.refresh_free_delivery_exempt();

commit;

-- ── Make the knobs take effect when they're changed ───────────────────────
-- Without this the exemptions only refresh on the next smart_reprice run, so
-- the owner would move a floor in Ops settings, see nothing change, and
-- reasonably conclude the setting does nothing.
begin;

create or replace function public._sync_free_delivery_gate()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.free_delivery_min_margin_pct    is distinct from old.free_delivery_min_margin_pct
  or new.free_delivery_min_margin_rupees is distinct from old.free_delivery_min_margin_rupees then
    perform public.refresh_free_delivery_exempt();
  end if;
  return null;   -- AFTER trigger
end; $$;

drop trigger if exists trg_sync_free_delivery_gate on public.ops_config;
create trigger trg_sync_free_delivery_gate
  after update on public.ops_config
  for each row execute function public._sync_free_delivery_gate();

commit;
