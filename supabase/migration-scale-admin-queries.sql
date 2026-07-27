-- Admin screens that don't grow with the shop.
--
-- Two of them were built to "fetch every order ever, then work it out in
-- JavaScript". That is fine at 70 orders and impossible at 70,000: the ops list
-- was re-downloading the entire order history WITH ITS LINE ITEMS every five
-- seconds, and the customer list counted each customer's lifetime orders by
-- filtering that same array.
--
-- Two changes, and the numbers stay exactly the same:
--   * counting moves into the database, where one indexed pass replaces shipping
--     the whole history to a phone;
--   * the ops list becomes a window (everything still moving, plus recent
--     history) rather than all of history. Anything that needs a customer's full
--     record asks for that one customer.

begin;

-- Lifetime orders and spend per customer, computed in the database.
-- Cancelled orders don't count as spend, which is the same rule the screen used.
create or replace function public.admin_customer_totals()
returns table (user_id uuid, orders int, spend numeric)
language sql stable security definer set search_path to 'public'
as $$
  select o.user_id, count(*)::int, coalesce(sum(o.total), 0)
    from public.orders o
   where public.is_admin()
     and o.user_id is not null
     and o.status <> 'Cancelled'
     and not o.is_topup
   group by o.user_id
$$;

revoke all on function public.admin_customer_totals() from public, anon;
grant execute on function public.admin_customer_totals() to authenticated;

commit;
