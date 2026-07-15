-- ============================================================================
-- MIGRATION: staff role for the NGS Partner (employee) app
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Employees log in like customers (email OTP) but the admin marks them 'staff'.
-- Staff can READ orders and ADVANCE their status (forward only) — they can
-- never change a price, total, coupon or payment amount. Admins can do
-- everything staff can (is_staff() returns true for admins too).
-- ============================================================================

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

-- Staff may read the order queue and the items in each order.
drop policy if exists "orders read own" on public.orders;
create policy "orders read own" on public.orders
  for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists "order_items read own" on public.order_items;
create policy "order_items read own" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())
    )
  );

-- Staff advance an order's status (Placed → Packed → Out for delivery →
-- Delivered), forward only. On Delivered, an order that wasn't paid online is
-- recorded as paid-by-cash. Staff cannot touch any money field directly.
create or replace function public.advance_order_status(p_order uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_flow  text[] := array['Placed', 'Packed', 'Out for delivery', 'Delivered'];
  v_cur   int;
  v_new   int;
begin
  if not public.is_staff() then
    raise exception 'Only staff can update deliveries.';
  end if;
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;

  v_new := array_position(v_flow, p_status);
  if v_new is null then raise exception 'Invalid status.'; end if;
  v_cur := array_position(v_flow, v_order.status);
  if v_cur is not null and v_new < v_cur then
    raise exception 'Status can only move forward.';
  end if;

  update public.orders set
    status = p_status,
    payment_status = case
      when p_status = 'Delivered' and payment_status <> 'paid' then 'paid'
      else payment_status end
  where id = p_order;
end;
$$;
grant execute on function public.advance_order_status(uuid, text) to authenticated;

-- Admin marks a customer as staff (or back to customer), by email. Used from
-- the admin Customers screen. Never touches an admin's own role.
create or replace function public.set_staff_role(p_email text, p_staff boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change roles.';
  end if;
  update public.profiles
    set role = case when p_staff then 'staff' else 'customer' end
    where lower(email) = lower(trim(p_email)) and role <> 'admin';
end;
$$;
grant execute on function public.set_staff_role(text, boolean) to authenticated;
