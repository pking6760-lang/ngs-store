-- "Trending now" — the products actually selling, for a live home rail.
--
-- Popularity only: product ids ranked by units sold in a recent window. No
-- customer, no order, nothing private leaves — so it is safe for anon to read.
-- Hidden categories (cigarettes) never trend; out-of-stock and inactive items
-- are excluded so the rail is always shoppable.

begin;

create or replace function public.trending_products(p_days int default 14, p_limit int default 12)
returns table(id text, units bigint)
language sql stable security definer set search_path to 'public'
as $$
  select oi.product_id as id, sum(oi.qty)::bigint as units
    from public.order_items oi
    join public.orders o   on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    left join public.categories c on c.id = p.category
   where o.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 14), 1))
     and o.status <> 'Cancelled'
     and coalesce(o.is_membership, false) = false
     and coalesce(o.is_topup, false)      = false
     and coalesce(o.is_return, false)      = false
     and p.active
     and coalesce(p.in_stock, true)
     and (p.stock is null or p.stock > 0)
     and not coalesce(c.hidden_from_home, false)
   group by oi.product_id
   order by units desc, oi.product_id
   limit greatest(coalesce(p_limit, 12), 1);
$$;

revoke all on function public.trending_products(int, int) from public;
grant execute on function public.trending_products(int, int) to anon, authenticated;

commit;
