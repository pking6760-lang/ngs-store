-- ════════════════════════════════════════════════════════════════════════════
-- Automation #4 — Buy again + reorder reminders.
--   • my_buy_again()          : products THIS customer has bought before, most
--     useful first, still buyable → a one-tap "Buy again" row on the home page.
--   • run_reorder_reminders() : a daily cron that notices when a staple someone
--     buys regularly is due again, and nudges just that one item — personalized,
--     with cooldowns so it never turns into spam.
-- ════════════════════════════════════════════════════════════════════════════

-- ── "Buy again" row — the caller's own purchase history, still on the shelf ──
create or replace function public.my_buy_again(p_limit int default 15)
 returns setof public.products
 language sql stable security definer set search_path to 'public'
as $function$
  select p.*
  from public.products p
  join (
    select oi.product_id,
      count(distinct o.id) as times,
      max(o.created_at)    as last_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.user_id = auth.uid()
      and o.status <> 'Cancelled'
      and not coalesce(o.is_return, false)
      and not coalesce(o.is_membership, false)
      and not coalesce(o.is_topup, false)
    group by oi.product_id
  ) h on h.product_id = p.id
  where p.active and coalesce(p.stock, 1) > 0 and p.price > 0
  order by h.last_at desc, h.times desc
  limit greatest(p_limit, 1);
$function$;
revoke execute on function public.my_buy_again(int) from public, anon;
grant execute on function public.my_buy_again(int) to authenticated;

-- ── Reorder reminders — nudge a regular staple when it's due again ───────────
create table if not exists public.reorder_sends (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  sent_date  date not null,
  primary key (user_id, product_id, sent_date)
);
alter table public.reorder_sends enable row level security;
revoke all on public.reorder_sends from anon, authenticated;

-- p_recent      : only nudge customers who ordered within this window (active)
-- p_item_cool   : don't re-nudge the same item within this many days
-- p_user_cool   : at most one reorder nudge per customer within this many days
create or replace function public.run_reorder_reminders(
  p_recent int default 45, p_item_cool int default 12, p_user_cool int default 5)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_count int;
begin
  with repeat_buys as (
    select o.user_id, oi.product_id, oi.name,
      count(distinct o.id) as times,
      min(o.created_at)    as first_at,
      max(o.created_at)    as last_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'Cancelled'
      and not coalesce(o.is_return, false)
      and not coalesce(o.is_membership, false)
      and not coalesce(o.is_topup, false)
    group by o.user_id, oi.product_id, oi.name
    having count(distinct o.id) >= 2
  ),
  overdue as (
    select rb.user_id, rb.product_id, rb.name,
      extract(epoch from (now() - rb.last_at))                            as since_sec,
      extract(epoch from (rb.last_at - rb.first_at)) / (rb.times - 1)     as avg_sec
    from repeat_buys rb
    where rb.last_at >= now() - make_interval(days => p_recent)
  ),
  ready as (
    select o.user_id, o.product_id, o.name, o.since_sec / o.avg_sec as ratio
    from overdue o
    where o.avg_sec > 0
      and o.since_sec >= o.avg_sec * 0.85
      and exists (select 1 from public.products p
                  where p.id = o.product_id and p.active and coalesce(p.stock, 1) > 0)
      and not exists (select 1 from public.reorder_sends rs
                      where rs.user_id = o.user_id and rs.product_id = o.product_id
                        and rs.sent_date > v_today - make_interval(days => p_item_cool))
      and not exists (select 1 from public.reorder_sends rs
                      where rs.user_id = o.user_id
                        and rs.sent_date > v_today - make_interval(days => p_user_cool))
  ),
  pick as (   -- the single most-overdue staple per customer
    select distinct on (user_id) user_id, product_id, name
    from ready
    order by user_id, ratio desc
  ),
  sent as (
    insert into public.notifications (user_id, title, body)
    select user_id, name || ' khatam hone wala? 🛒',
           'Aap aksar ' || name || ' lete ho — lagta hai reorder ka time aa gaya. 2 tap me ghar par. 🛵'
    from pick
    returning user_id
  ),
  logged as (
    insert into public.reorder_sends (user_id, product_id, sent_date)
    select user_id, product_id, v_today from pick
    on conflict do nothing
    returning user_id
  )
  select count(*) into v_count from logged;
  return coalesce(v_count, 0);
end; $function$;
revoke execute on function public.run_reorder_reminders(int, int, int) from public, anon, authenticated;

-- Daily at 09:30 UTC = 15:00 IST (afternoon; per-user cooldown keeps it rare).
select cron.unschedule('reorder-reminders') where exists (select 1 from cron.job where jobname='reorder-reminders');
select cron.schedule('reorder-reminders', '30 9 * * *', 'select public.run_reorder_reminders()');
