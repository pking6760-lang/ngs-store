-- ════════════════════════════════════════════════════════════════════════════
-- Keep membership status invisible to delivery/picker partners.
--
-- Partners have profiles.role = 'staff', and the orders SELECT policy allowed
-- is_staff() — so a rider could query the raw orders table with their own token
-- and read the `member` / membership / bonus columns, even though the app never
-- shows them. Membership is OUR planning signal, not the rider's business.
--
-- Fix: partners get order data ONLY through the privacy-scoped get_my_task()
-- SECURITY DEFINER RPC (which never returns member fields). Restrict the broad
-- orders read to the owner (is_admin). Customers still read their own orders;
-- the partner app uses RPCs only, so nothing there breaks.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "orders read own" on public.orders;
create policy "orders read own" on public.orders
  for select using ((user_id = auth.uid()) or public.is_admin());

-- order_items carries no membership info, but a rider only needs it via
-- get_my_task() too — keep its broad read to the owner for the same reason.
drop policy if exists "order_items read own" on public.order_items;
create policy "order_items read own" on public.order_items
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );
