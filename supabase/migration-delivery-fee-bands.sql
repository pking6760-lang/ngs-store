-- Distance-banded delivery fee.
--
-- The last remaining structural mismatch on the customer side: the delivery fee
-- was flat (Rs20) while the cost of the delivery is not. Rider pay is
-- max(Rs7 + Rs16/km, Rs18), so a doorstep drop costs Rs18 and a 3km ride costs
-- Rs55. A flat Rs20 fee is over-charging the near customer to subsidise the far
-- one, and still loses money at the edge of the radius.
--
-- Three bands, solved so every distance clears its own cost on a thin-margin
-- cart (Rs15 item margin + Rs7 handling):
--
--   under 1.5km  Rs20  ->  +Rs14 to +Rs19
--   1.5 - 2.5km  Rs35  ->  +Rs13 to +Rs21
--   2.5km+       Rs50  ->  +Rs12 to +Rs20
--
-- Rs20 near is still below Blinkit's and Zepto's flat Rs30. The far bands are
-- higher than both, which is honest: neither of them is riding 3km for a single
-- bottle of mustard oil on a kirana's margin. Crossing the free-delivery bar
-- (Rs199 near, Rs399 far) removes the fee entirely at any distance.

begin;

alter table public.ops_config
  add column if not exists delivery_fee_mid numeric not null default 35,
  add column if not exists delivery_fee_far numeric not null default 50,
  add column if not exists far_zone_km_2    numeric not null default 2.5;

alter table public.ops_config
  drop constraint if exists ops_config_fee_bands_sane;
alter table public.ops_config
  add constraint ops_config_fee_bands_sane check (
    delivery_fee_mid >= 0 and delivery_fee_mid <= 500
    and delivery_fee_far >= 0 and delivery_fee_far <= 500
    and far_zone_km_2 >= 0 and far_zone_km_2 <= 50
  );

alter table public.settings
  add column if not exists delivery_fee_mid numeric not null default 35,
  add column if not exists delivery_fee_far numeric not null default 50,
  add column if not exists far_zone_km_2    numeric not null default 2.5;

create or replace function public.sync_ops_to_settings()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.settings set
    handling_fee            = new.handling_fee,
    delivery_fee            = new.delivery_fee,
    free_delivery_above     = new.free_delivery_threshold,
    surge_fee               = new.surge_fee,
    cod_customer_limit      = new.cod_customer_limit,
    small_cart_fee          = new.small_cart_fee,
    small_cart_threshold    = new.small_cart_threshold,
    far_zone_km             = new.far_zone_km,
    free_delivery_far_above = new.free_delivery_far_above,
    delivery_fee_mid        = new.delivery_fee_mid,
    delivery_fee_far        = new.delivery_fee_far,
    far_zone_km_2           = new.far_zone_km_2
  where id = 1;
  return new;
end;
$$;

update public.settings s set
  delivery_fee_mid = o.delivery_fee_mid,
  delivery_fee_far = o.delivery_fee_far,
  far_zone_km_2    = o.far_zone_km_2
from public.ops_config o where s.id = 1 and o.id = 1;

commit;
