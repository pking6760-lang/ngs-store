-- ════════════════════════════════════════════════════════════════════════════
-- Back-in-stock alerts. A customer taps "Notify me" on a sold-out product; when
-- the shop restocks it, everyone waiting gets a push automatically (recovering
-- a sale that would otherwise be lost).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  product_id  text not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, product_id)
);
alter table public.stock_alerts enable row level security;
drop policy if exists sa_own on public.stock_alerts;
create policy sa_own on public.stock_alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Register (or re-arm) an alert for the signed-in customer.
create or replace function public.set_stock_alert(p_product_id text)
 returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.stock_alerts (user_id, product_id)
  values (auth.uid(), p_product_id)
  on conflict (user_id, product_id) do update set created_at = now(), notified_at = null;
end $$;
grant execute on function public.set_stock_alert(text) to authenticated;

create or replace function public.clear_stock_alert(p_product_id text)
 returns void language plpgsql security definer set search_path to 'public' as $$
begin
  delete from public.stock_alerts where user_id = auth.uid() and product_id = p_product_id;
end $$;
grant execute on function public.clear_stock_alert(text) to authenticated;

-- The product ids the customer is currently waiting on (button state).
create or replace function public.my_stock_alerts()
 returns setof text language sql security definer set search_path to 'public' as $$
  select product_id from public.stock_alerts
   where user_id = auth.uid() and notified_at is null;
$$;
grant execute on function public.my_stock_alerts() to authenticated, anon;

-- When stock crosses from 0 → positive, push everyone who was waiting, then
-- mark them notified. Inserting into notifications auto-sends the push
-- (trg_notify_customer).
create or replace function public._notify_back_in_stock()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if coalesce(OLD.stock, 0) <= 0 and coalesce(NEW.stock, 0) > 0 then
    for r in
      select user_id from public.stock_alerts
       where product_id = NEW.id and notified_at is null
    loop
      insert into public.notifications (user_id, title, body)
      values (r.user_id, 'Back in stock 🎉',
              NEW.name || ' is available again — grab it before it''s gone.');
    end loop;
    update public.stock_alerts set notified_at = now()
     where product_id = NEW.id and notified_at is null;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_back_in_stock on public.products;
create trigger trg_back_in_stock
  after update of stock on public.products
  for each row execute function public._notify_back_in_stock();

select 'stock alerts ready' as status;
