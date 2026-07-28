-- Flash sale — a short, time-boxed price with a live countdown, for urgency.
--
-- Design that is safe by construction:
--   * The flash is an OVERLAY (flash_price + flash_ends_at). We never touch the
--     product's real `price`, so the auto-pricer keeps managing it and there is
--     nothing to "restore" when the flash ends.
--   * Expiry is automatic: checkout reads flash_ends_at > now() live, so a lapsed
--     flash simply stops applying — no cron is needed for correctness.
--   * The flash price is floored at cost on the way IN (set_flash_sale rejects a
--     price below ceil(cost * (1+floor_markup))), and at checkout the flash price
--     is charged FLAT — no member/bulk discount stacks on top of it, exactly like
--     a combo component. So no path can sell a flash item under cost, and the
--     coupon margin-cap (which already subtracts cost from the flash unit price)
--     keeps flash + coupon safe too.

begin;

alter table public.products
  add column if not exists flash_price   numeric,
  add column if not exists flash_ends_at timestamptz;

-- Start a flash sale on one product: a price, for N minutes.
-- Admin only. Rejects anything that would sell at a loss or isn't a real,
-- short, genuine discount.
create or replace function public.set_flash_sale(p_id text, p_price numeric, p_minutes int)
returns timestamptz
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prod   public.products;
  v_cost   numeric;
  v_floor  numeric;
  v_markup numeric;
  v_ends   timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  select * into v_prod from public.products where id = p_id;
  if v_prod.id is null then raise exception 'Product not found.'; end if;
  if v_prod.active is false then raise exception 'Product is not active.'; end if;

  if p_price is null or p_price <= 0 then raise exception 'Flash price must be positive.'; end if;
  if p_price >= v_prod.price then
    raise exception 'Flash price Rs % must be below the current price Rs %.', p_price, v_prod.price;
  end if;
  if v_prod.mrp is not null and p_price > v_prod.mrp then
    raise exception 'Flash price cannot be above MRP Rs %.', v_prod.mrp;
  end if;
  if coalesce(p_minutes, 0) < 5 or p_minutes > 1440 then
    raise exception 'Flash length must be between 5 minutes and 24 hours.';
  end if;

  -- Never sell under cost. If we know the buying cost, floor the flash at
  -- ceil(cost * (1 + floor_markup)) — the same floor the auto-pricer uses.
  select cost into v_cost from public.product_costs where product_id = p_id;
  select floor_markup into v_markup from public.pricing_config where id = 1;
  if v_cost is not null then
    v_floor := ceil(v_cost * (1 + coalesce(v_markup, 0.04)));
    if p_price < v_floor then
      raise exception 'Flash price Rs % is below the safe floor Rs % (would sell at a loss).',
        p_price, v_floor;
    end if;
  end if;

  v_ends := now() + make_interval(mins => p_minutes);
  update public.products
     set flash_price = p_price, flash_ends_at = v_ends
   where id = p_id;
  return v_ends;
end;
$$;

-- End a flash sale early (or clean one off a product).
create or replace function public.clear_flash_sale(p_id text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.products
     set flash_price = null, flash_ends_at = null
   where id = p_id;
end;
$$;

-- Tidiness only (not required for correctness): null out flashes that have
-- ended, so admin lists stay clean. Safe for anyone to run; it only clears
-- already-expired rows.
create or replace function public.expire_flash_sales()
returns int
language sql security definer set search_path to 'public'
as $$
  with done as (
    update public.products
       set flash_price = null, flash_ends_at = null
     where flash_ends_at is not null and flash_ends_at <= now()
     returning 1
  )
  select count(*)::int from done;
$$;

revoke all on function public.set_flash_sale(text, numeric, int)   from public;
revoke all on function public.clear_flash_sale(text)               from public;
revoke all on function public.expire_flash_sales()                 from public;
grant execute on function public.set_flash_sale(text, numeric, int) to authenticated;
grant execute on function public.clear_flash_sale(text)             to authenticated;
grant execute on function public.expire_flash_sales()               to authenticated, anon;

commit;
