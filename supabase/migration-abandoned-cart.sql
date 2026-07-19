-- ════════════════════════════════════════════════════════════════════════════
-- Abandoned-cart recovery.
--   The cart lives on the phone; to notice when someone fills it and walks away,
--   we mirror a signed-in customer's cart to the server (debounced) via
--   save_cart(). A cron then finds carts that have sat untouched for a while with
--   no order placed since, and drops a gentle "your cart is waiting" nudge —
--   which the existing notify-customer trigger pushes to their phone.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.carts (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  items      jsonb not null default '{}'::jsonb,   -- { productId: qty }
  item_count int not null default 0,               -- total units, for the message
  updated_at timestamptz not null default now(),
  nudged_at  timestamptz
);
alter table public.carts enable row level security;
drop policy if exists cart_own on public.carts;
create policy cart_own on public.carts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.carts from anon;

-- Client mirror. Upserts the caller's cart; server owns updated_at. Changing the
-- contents clears nudged_at so a freshly-changed cart can be nudged again later;
-- an unchanged re-save (or emptying on checkout) keeps it.
create or replace function public.save_cart(p_items jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_count int; v_items jsonb := coalesce(p_items, '{}'::jsonb);
begin
  if auth.uid() is null then return; end if;
  select coalesce(sum(value::int), 0) into v_count from jsonb_each_text(v_items);
  insert into public.carts (user_id, items, item_count, updated_at, nudged_at)
    values (auth.uid(), v_items, v_count, now(), null)
  on conflict (user_id) do update set
    items = excluded.items,
    item_count = excluded.item_count,
    updated_at = now(),
    nudged_at = case when public.carts.items is distinct from excluded.items
                     then null else public.carts.nudged_at end;
end; $function$;
revoke execute on function public.save_cart(jsonb) from public, anon;
grant execute on function public.save_cart(jsonb) to authenticated;

-- The recovery engine. Nudges carts that:
--   • have items,
--   • have sat untouched for >= p_min minutes (abandoned), but
--   • are still fresh (< p_fresh_hours old — don't chase week-old carts),
--   • weren't nudged within p_cool_min minutes, and
--   • the customer hasn't ordered since the cart was last touched.
create or replace function public.run_abandoned_cart(
  p_min int default 45, p_fresh_hours int default 24, p_cool_min int default 720)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  with due as (
    select c.user_id, c.item_count
    from public.carts c
    where c.item_count > 0
      and c.updated_at <  now() - make_interval(mins  => p_min)
      and c.updated_at >= now() - make_interval(hours => p_fresh_hours)
      and (c.nudged_at is null or c.nudged_at < now() - make_interval(mins => p_cool_min))
      and not exists (
        select 1 from public.orders o
        where o.user_id = c.user_id and o.created_at >= c.updated_at
          and o.status <> 'Cancelled'
      )
  ),
  sent as (
    insert into public.notifications (user_id, title, body)
    select user_id, 'Aapka cart wait kar raha hai 🛒',
      'Cart me ' || item_count || ' item' || case when item_count = 1 then '' else 's' end
      || ' reh gaye — order pura karo, 10 min me ghar par! 🛵'
    from due
    returning user_id
  ),
  logged as (
    update public.carts set nudged_at = now()
    where user_id in (select user_id from due)
    returning user_id
  )
  select count(*) into v_count from logged;
  return coalesce(v_count, 0);
end; $function$;
revoke execute on function public.run_abandoned_cart(int, int, int) from public, anon, authenticated;

-- Every 15 minutes.
select cron.unschedule('abandoned-cart') where exists (select 1 from cron.job where jobname='abandoned-cart');
select cron.schedule('abandoned-cart', '*/15 * * * *', 'select public.run_abandoned_cart()');
