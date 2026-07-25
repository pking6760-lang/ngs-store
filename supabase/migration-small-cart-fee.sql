-- Small cart charge — a flat fee on orders below a threshold, waived above it.
--
-- Why: a ₹34 order costs the same to pick and ride out as a ₹340 one. The
-- delivery fee alone does not cover a tiny basket, so very small orders are
-- loss-making. This nudges customers to add a little more, exactly like the
-- delivery-fee threshold already does.
--
-- Charged on the ITEM TOTAL BEFORE discounts and redemptions, so a coupon
-- cannot be used to duck under the threshold and then also skip the fee.
-- Applies to EVERYONE including Prime members — the Prime perk is free
-- delivery, and a tiny basket still costs the shop the same to fulfil.
-- Computed entirely server-side in _place_order_core; the client value is
-- display only and is never trusted.

begin;

-- ── 1. Config ───────────────────────────────────────────────────────────────
alter table public.ops_config
  add column if not exists small_cart_fee       numeric not null default 20,
  add column if not exists small_cart_threshold numeric not null default 99;

alter table public.ops_config
  drop constraint if exists ops_config_small_cart_sane;
alter table public.ops_config
  add constraint ops_config_small_cart_sane check (
    small_cart_fee >= 0 and small_cart_fee <= 200
    and small_cart_threshold >= 0 and small_cart_threshold <= 5000
  );

alter table public.settings
  add column if not exists small_cart_fee       numeric not null default 20,
  add column if not exists small_cart_threshold numeric not null default 99;

-- Keep the customer-facing mirror in step with the source of truth.
create or replace function public.sync_ops_to_settings()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.settings set
    handling_fee         = new.handling_fee,
    delivery_fee         = new.delivery_fee,
    free_delivery_above  = new.free_delivery_threshold,
    surge_fee            = new.surge_fee,
    cod_customer_limit   = new.cod_customer_limit,
    small_cart_fee       = new.small_cart_fee,
    small_cart_threshold = new.small_cart_threshold
  where id = 1;
  return new;
end;
$$;

-- Seed the mirror from the current config (the trigger only fires on update).
update public.settings s set
  small_cart_fee       = o.small_cart_fee,
  small_cart_threshold = o.small_cart_threshold
from public.ops_config o where s.id = 1 and o.id = 1;

-- ── 2. Orders ledger ────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists small_cart_fee numeric not null default 0;

commit;
