-- "Frequently bought together" — real market-basket co-occurrence.
-- Given the product ids currently in the cart, find products that appeared in
-- the SAME past orders as those items, ranked by how many distinct orders they
-- co-occurred in. We require a co-occurrence of at least 2 distinct orders so a
-- single coincidental basket never becomes a "frequently bought" claim — if the
-- signal isn't there, the RPC returns nothing and the UI simply hides the row.
-- Items already in the cart, and anything out of stock, are excluded.
create or replace function public.frequently_bought_together(p_cart_ids text[], p_limit int default 6)
returns setof products
language sql
stable security definer
set search_path to 'public'
as $$
  with anchor_orders as (
    select distinct oi.order_id
    from public.order_items oi
    where oi.product_id = any(coalesce(p_cart_ids, '{}'))
  ),
  co as (
    select oi.product_id as id, count(distinct oi.order_id) as n
    from public.order_items oi
    join anchor_orders ao on ao.order_id = oi.order_id
    where not (oi.product_id = any(coalesce(p_cart_ids, '{}')))
    group by oi.product_id
    having count(distinct oi.order_id) >= 2
  )
  select p.*
  from co
  join public.products p on p.id = co.id
  where p.active and coalesce(p.stock, 1) > 0 and p.price > 0
  order by co.n desc, p.price desc
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

grant execute on function public.frequently_bought_together(text[], int) to authenticated, anon;
