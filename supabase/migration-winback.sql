-- ════════════════════════════════════════════════════════════════════════════
-- Personalized win-back — nudge lapsed customers with THEIR favourite item.
--
-- Finds customers whose last (non-cancelled) order is older than p_days and who
-- have ordered before, then drops a personalized notification into each inbox
-- naming the item they buy most. Reuses the notification system + the order
-- history we already store. Admin-only; returns how many were nudged.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.send_winback(p_days int default 14)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_count int := 0; r record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can send notifications.';
  end if;

  for r in
    select p.id, p.name,
      (select oi.name
         from public.order_items oi
         join public.orders o2 on o2.id = oi.order_id
         where o2.user_id = p.id and o2.status <> 'Cancelled'
         group by oi.name order by sum(oi.qty) desc limit 1) as top_item
    from public.profiles p
    join public.orders o on o.user_id = p.id and o.status <> 'Cancelled'
    where p.role = 'customer'
    group by p.id, p.name
    having max(o.created_at) < now() - make_interval(days => greatest(p_days, 1))
  loop
    insert into public.notifications (user_id, title, body)
      values (
        r.id,
        'We miss you' || case when coalesce(r.name,'') <> '' then ', ' || split_part(r.name, ' ', 1) else '' end || '! 🛒',
        case when r.top_item is not null
             then 'Your favourite ' || r.top_item || ' is waiting — reorder in 2 taps and get it in minutes.'
             else 'Fresh daily essentials in minutes. Come see what''s new!' end
      );
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;

revoke execute on function public.send_winback(int) from public, anon;
grant execute on function public.send_winback(int) to authenticated;
