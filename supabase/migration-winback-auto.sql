-- ════════════════════════════════════════════════════════════════════════════
-- Automation #3 — Win back lapsed customers, automatically.
--   The manual, admin-triggered send_winback() already exists. This adds the
--   AUTOMATED layer: a daily cron that nudges customers who've drifted away,
--   personalized with THEIR favourite item, with a cooldown so nobody is nagged.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.winback_sends (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  sent_date date not null,
  primary key (user_id, sent_date)
);
alter table public.winback_sends enable row level security;
revoke all on public.winback_sends from anon, authenticated;

-- p_days     : inactive at least this many days → eligible
-- p_recent   : skip accounts whose last order is older than this (truly dead)
-- p_cooldown : never send another win-back within this many days
create or replace function public.run_winback(
  p_days int default 14, p_recent int default 120, p_cooldown int default 12)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_count int := 0; r record;
begin
  for r in
    select p.id, p.name,
      (select oi.name
         from public.order_items oi
         join public.orders o2 on o2.id = oi.order_id
         where o2.user_id = p.id and o2.status <> 'Cancelled'
         group by oi.name order by sum(oi.qty) desc limit 1) as top_item
    from public.profiles p
    join public.orders o on o.user_id = p.id
      and o.status <> 'Cancelled'
      and not coalesce(o.is_return, false)
      and not coalesce(o.is_membership, false)
      and not coalesce(o.is_topup, false)
    where p.role = 'customer'
    group by p.id, p.name
    having max(o.created_at) <  now() - make_interval(days => greatest(p_days, 1))
       and max(o.created_at) >= now() - make_interval(days => greatest(p_recent, p_days))
       and not exists (
         select 1 from public.winback_sends w
         where w.user_id = p.id and w.sent_date > v_today - make_interval(days => p_cooldown)
       )
  loop
    insert into public.notifications (user_id, title, body)
      values (
        r.id,
        'Aapki yaad aa rahi' || case when coalesce(r.name,'') <> '' then ', ' || split_part(r.name, ' ', 1) else '' end || ' 💚',
        case when r.top_item is not null
             then 'Aapka favourite ' || r.top_item || ' wait kar raha hai — 2 tap me reorder karo, minutes me ghar par. 🛒'
             else 'Bahut din ho gaye! Roz ka saamaan NGS se, 10 min me ghar par. Aa jao na. 🏡' end
      );
    insert into public.winback_sends (user_id, sent_date) values (r.id, v_today)
      on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke execute on function public.run_winback(int, int, int) from public, anon, authenticated;

-- Daily at 11:30 UTC = 17:00 IST (early evening — a good ordering hour).
select cron.unschedule('winback') where exists (select 1 from cron.job where jobname='winback');
select cron.schedule('winback', '30 11 * * *', 'select public.run_winback()');
