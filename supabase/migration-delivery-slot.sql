-- ════════════════════════════════════════════════════════════════════════════
-- Customer delivery-time slot. At checkout the shopper can pick when the order
-- should arrive — "Now" (express) or a scheduled window. The chosen window is
-- stored as a human label on the order and shown to the customer, the admin and
-- (later) the rider. It is pure scheduling metadata: it never touches pricing.
--
-- Implementation note: we do NOT modify _place_order_core (all the money math).
-- Instead the public place_order wrapper takes one extra param and, after the
-- core has created the order, stamps the slot with a plain UPDATE.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists delivery_slot text;

-- Replace the 8-arg wrapper with a 9-arg one (extra param defaulted, so existing
-- callers that don't pass it keep working). Drop the old signature first so we
-- don't leave an ambiguous overload for PostgREST to choose between.
drop function if exists public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean);

create or replace function public.place_order(
  p_items          jsonb,
  p_coupon         text    default null,
  p_location       jsonb   default null,
  p_payment        text    default 'upi',
  p_address        text    default null,
  p_wallet         numeric default 0,
  p_redeem_points  integer default 0,
  p_membership     boolean default false,
  p_deliver_slot   text    default null
) returns public.orders
  language plpgsql security definer set search_path to 'public'
as $$
declare v_order public.orders;
begin
  v_order := public._place_order_core(auth.uid(), p_items, p_coupon, p_location,
    p_payment, p_address, p_wallet, p_redeem_points, p_membership, true);

  -- Stamp the chosen delivery window (null / blank = express "Now").
  if p_deliver_slot is not null and btrim(p_deliver_slot) <> '' then
    update public.orders set delivery_slot = p_deliver_slot where id = v_order.id;
    v_order.delivery_slot := p_deliver_slot;
  end if;

  return v_order;
end;
$$;

grant execute on function public.place_order(jsonb, text, jsonb, text, text, numeric, integer, boolean, text)
  to authenticated;

select 'delivery slot ready' as status;
