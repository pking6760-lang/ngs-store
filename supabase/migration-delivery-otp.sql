-- Proof-of-delivery OTP (audit #2). A 4-digit code per physical-delivery order.
-- The CUSTOMER sees it on their order page; the RIDER must enter it to mark the
-- order delivered. The code lives in its own table that ONLY the customer can
-- read (never the rider), so a rider can't self-complete without actually being
-- at the door. Admin can still override; returns have no code.

begin;

create table if not exists public.order_delivery_codes (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now()
);
alter table public.order_delivery_codes enable row level security;
-- Only the order's owner may read their code. No client writes at all (the
-- trigger below, service-role, is the only writer) — so a rider can never read it.
drop policy if exists odc_owner_read on public.order_delivery_codes;
create policy odc_owner_read on public.order_delivery_codes for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

-- Generate a code on every new physical-delivery order (skip membership, wallet
-- top-up, returns, and the subscription umbrella order — none are doorstep drops).
create or replace function public._gen_delivery_code()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(new.is_membership, false) or coalesce(new.is_topup, false)
     or coalesce(new.is_return, false) or coalesce(new.is_subscription, false) then
    return new;
  end if;
  insert into public.order_delivery_codes (order_id, code)
    values (new.id, lpad(floor(random() * 10000)::int::text, 4, '0'))
    on conflict (order_id) do nothing;
  return new;
end; $$;
drop trigger if exists trg_gen_delivery_code on public.orders;
create trigger trg_gen_delivery_code after insert on public.orders
  for each row execute function public._gen_delivery_code();

-- Backfill codes for in-flight orders not yet delivered, so the OTP applies to
-- current deliveries too (older/completed orders are left alone).
insert into public.order_delivery_codes (order_id, code)
  select o.id, lpad(floor(random() * 10000)::int::text, 4, '0')
  from public.orders o
  where not coalesce(o.is_membership, false) and not coalesce(o.is_topup, false)
    and not coalesce(o.is_return, false) and not coalesce(o.is_subscription, false)
    and o.status in ('Placed', 'Accepted', 'Packed', 'Out for delivery', 'Scheduled')
  on conflict (order_id) do nothing;

-- Replace partner_mark_delivered with a code-checked version. Drop the old 2-arg
-- signature first, then create the 3-arg (p_code defaulted so existing 2-arg
-- named-param callers still resolve to it).
drop function if exists public.partner_mark_delivered(uuid, numeric);
create or replace function public.partner_mark_delivered(p_order uuid, p_tendered numeric default null, p_code text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_rid uuid; v_state text; v_ret boolean; v_milk boolean; v_code text;
begin
  select rider_id, delivery_state, coalesce(is_return, false),
         (subscription_id is not null and not coalesce(is_subscription, false))
    into v_rid, v_state, v_ret, v_milk
    from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  if not public.is_admin() and not v_ret and not v_milk
     and v_state <> 'out_for_delivery' then
    raise exception 'Slide "Out for delivery" first — collect the payment at the customer''s door.';
  end if;

  -- Proof of delivery: a non-admin rider must enter the customer's code. Admin
  -- overrides (customer unreachable, etc.); returns and orders without a code
  -- (older ones) are exempt.
  if not public.is_admin() and not v_ret then
    select code into v_code from public.order_delivery_codes where order_id = p_order;
    if v_code is not null and coalesce(p_code, '') <> v_code then
      raise exception 'Wrong delivery code. Ask the customer for the 4-digit code on their order screen.';
    end if;
  end if;

  perform public._complete_delivery(p_order, p_tendered);
end; $$;
revoke all on function public.partner_mark_delivered(uuid, numeric, text) from public, anon;
grant execute on function public.partner_mark_delivered(uuid, numeric, text) to authenticated;

commit;
