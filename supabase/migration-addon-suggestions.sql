-- "Add something extra" suggestions: in-stock products where WE make good
-- margin, ranked by that margin, excluding what's already in the cart. Cost is
-- read server-side only — the customer never sees it (returns just the public
-- product columns).
create or replace function public.suggest_addons(p_exclude text[] default '{}', p_limit int default 8)
 returns setof public.products
 language sql stable security definer set search_path to 'public'
as $function$
  select p.*
  from public.products p
  join public.product_costs pc on pc.product_id = p.id
  where p.active
    and coalesce(p.stock, 1) > 0
    and not (p.id = any(coalesce(p_exclude, '{}')))
    and p.price > 0
    and ((p.price - pc.cost) / p.price) >= 0.12
  order by ((p.price - pc.cost) / p.price) desc, p.hot desc, p.price asc
  limit greatest(p_limit, 1);
$function$;
grant execute on function public.suggest_addons(text[], int) to anon, authenticated;
