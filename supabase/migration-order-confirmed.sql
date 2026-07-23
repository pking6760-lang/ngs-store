-- "Order confirmed" message the moment an order is placed.
--  • COD orders are inserted straight as 'Placed'   → AFTER INSERT trigger.
--  • Online orders are inserted 'Awaiting payment' and flip to 'Placed' once
--    paid                                            → the AFTER UPDATE trigger.
-- The two paths are mutually exclusive, so the customer gets exactly one
-- confirmation.

-- Shared wording, so both triggers stay identical.
create or replace function public._order_placed_msg(p_status text, p_code text, out title text, out body text)
language plpgsql immutable as $$
begin
  if p_status = 'Scheduled' then
    title := 'Order scheduled';
    body  := 'Your order ' || p_code || ' has been scheduled. We''ll notify you when it''s on its way.';
  else
    title := 'Order confirmed';
    body  := 'Your order ' || p_code || ' has been placed successfully. We''ll begin preparing it shortly.';
  end if;
end; $$;

-- AFTER INSERT: COD (and any order created already 'Placed'/'Scheduled').
create or replace function public._notify_order_placed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_t text; v_b text;
begin
  if coalesce(NEW.is_membership,false) or coalesce(NEW.is_topup,false) or coalesce(NEW.is_return,false) then return NEW; end if;
  if NEW.subscription_id is not null and not coalesce(NEW.is_subscription,false) then return NEW; end if; -- skip daily sub child orders
  if NEW.user_id is null then return NEW; end if;
  if NEW.status in ('Placed','Scheduled') then
    select title, body into v_t, v_b from public._order_placed_msg(NEW.status, coalesce(NEW.human_code,''));
    insert into public.notifications (user_id, title, body) values (NEW.user_id, v_t, v_b);
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_notify_order_placed on public.orders;
create trigger trg_notify_order_placed
  after insert on public.orders
  for each row execute function public._notify_order_placed();

-- AFTER UPDATE: add the 'Placed'/'Scheduled' confirmation (online orders that
-- just got paid) to the existing status-notification function.
create or replace function public._notify_order_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_title text; v_body text; v_code text; v_sub boolean;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if coalesce(NEW.is_membership,false) or coalesce(NEW.is_topup,false) or coalesce(NEW.is_return,false) then return NEW; end if;
  if NEW.user_id is null then return NEW; end if;
  v_code := coalesce(NEW.human_code, '');
  v_sub := NEW.subscription_id is not null and not coalesce(NEW.is_subscription, false);

  if v_sub then
    if NEW.status = 'Packed' then
      v_title := 'Daily delivery packed';
      v_body  := 'Your daily delivery ' || v_code || ' has been packed and is ready.';
    elsif NEW.status = 'Out for delivery' then
      v_title := 'Daily delivery on the way';
      v_body  := 'Your daily delivery ' || v_code || ' is on its way to you.';
    elsif NEW.status = 'Delivered' then
      v_title := 'Daily delivery completed';
      v_body  := 'Your daily delivery ' || v_code || ' has been delivered. Thank you for choosing NGS Store.';
    elsif NEW.status = 'Cancelled' then
      v_title := 'Delivery skipped';
      v_body  := 'Your subscription delivery ' || v_code || ' for today has been cancelled.';
    else
      return NEW;
    end if;
  else
    if NEW.status in ('Placed','Scheduled') then
      select title, body into v_title, v_body from public._order_placed_msg(NEW.status, v_code);
    elsif NEW.status = 'Packed' then
      v_title := 'Order packed';
      v_body  := 'Your order ' || v_code || ' has been packed and is ready for delivery.';
    elsif NEW.status = 'Out for delivery' then
      v_title := 'Out for delivery';
      v_body  := 'Your order ' || v_code || ' is on its way and will reach you shortly.';
    elsif NEW.status = 'Delivered' then
      v_title := 'Order delivered';
      v_body  := 'Your order ' || v_code || ' has been delivered. Thank you for shopping with NGS Store.';
    elsif NEW.status = 'Cancelled' then
      v_title := 'Order cancelled';
      v_body  := 'Your order ' || v_code || ' has been cancelled. Any refund due will be credited to your NGS wallet.';
    else
      return NEW;
    end if;
  end if;

  insert into public.notifications (user_id, title, body) values (NEW.user_id, v_title, v_body);
  return NEW;
end; $$;
