-- ════════════════════════════════════════════════════════════════════════════
-- Manual availability flag. The admin "In stock / Out of stock" toggle needs a
-- real column to persist — previously it wrote `inStock` which PostgREST
-- silently dropped (no matching column), so the toggle never stuck.
--
-- `stock` (a number) is the automatic counter; `in_stock` (a boolean) is the
-- owner's manual override — "hide this from sale right now" even if a count
-- isn't tracked. A product is sold-out when in_stock is false OR stock <= 0.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists in_stock boolean not null default true;

-- Re-arm back-in-stock alerts for the manual flag too: a customer waiting on a
-- product should be pushed whether it comes back via the counter (stock 0 →
-- positive) OR the owner flipping the manual toggle back on (in_stock f → t).
create or replace function public._notify_back_in_stock()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record;
  v_was_out boolean;
  v_now_in  boolean;
begin
  -- "Out" before this update = manual off OR counter empty.
  v_was_out := (OLD.in_stock is false) or (coalesce(OLD.stock, 0) <= 0);
  -- "Available" after this update = manual on AND (no counter OR counter positive).
  v_now_in  := (NEW.in_stock is not false)
               and (NEW.stock is null or NEW.stock > 0);

  if v_was_out and v_now_in then
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

-- Fire on either signal now (was: only `of stock`).
drop trigger if exists trg_back_in_stock on public.products;
create trigger trg_back_in_stock
  after update of stock, in_stock on public.products
  for each row execute function public._notify_back_in_stock();

select 'product in_stock ready' as status;
