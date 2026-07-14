-- ════════════════════════════════════════════════════════════════════════════
-- Smart "Add something extra" — a bigger, self-learning cross-sell.
--
-- Each candidate gets a score blended from four signals, so it starts random for
-- a new shopper and gets sharper as we learn their behaviour:
--   • personal  — how often THIS customer bought it before (reorder reminder)
--   • together  — how often it's bought WITH what's in their cart (goes-with)
--   • margin    — how much WE earn on it (bigger cart = more profit)
--   • random    — exploration, so items rotate and we keep learning
-- Cold start (no history): margin + random dominate → looks random/high-margin.
-- As orders pile up: personal + together take over → behaviour-driven picks.
-- Cost stays server-side; only the public product row is returned.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.suggest_addons(p_exclude text[] default '{}', p_limit int default 12)
 returns setof public.products
 language sql stable security definer set search_path to 'public'
as $function$
  -- All buyable items not already in the cart. Margin is a bias, not a gate, so
  -- the row always fills to the limit; high-margin items simply rank higher.
  with cand as (
    select p.id,
      coalesce((p.price - pc.cost) / nullif(p.price, 0), 0.12) as margin
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    where p.active
      and coalesce(p.stock, 1) > 0
      and p.price > 0
      and not (p.id = any(coalesce(p_exclude, '{}')))
  ),
  -- Reorder reminders: what this customer has bought before.
  personal as (
    select oi.product_id as id, count(*)::numeric as n
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.user_id = auth.uid() and o.status <> 'Cancelled'
    group by oi.product_id
  ),
  -- Baskets that contained something currently in the cart.
  baskets as (
    select distinct oi.order_id
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = any(coalesce(p_exclude, '{}')) and o.status <> 'Cancelled'
  ),
  -- "Bought together": what else shows up in those baskets.
  together as (
    select oi.product_id as id, count(*)::numeric as n
    from public.order_items oi
    join baskets b on b.order_id = oi.order_id
    where not (oi.product_id = any(coalesce(p_exclude, '{}')))
    group by oi.product_id
  ),
  scored as (
    select c.id,
      coalesce(pe.n, 0) * 3.0      -- personal reorder pull
      + coalesce(tg.n, 0) * 2.5    -- bought-together pull
      + c.margin * 3.0             -- our-margin bias (0..3)
      + random() * 3.0             -- exploration / rotation (0..3)
      as score
    from cand c
    left join personal pe on pe.id = c.id
    left join together tg on tg.id = c.id
  )
  select p.* from public.products p
  join scored s on s.id = p.id
  order by s.score desc
  limit greatest(p_limit, 1);
$function$;
grant execute on function public.suggest_addons(text[], int) to anon, authenticated;
