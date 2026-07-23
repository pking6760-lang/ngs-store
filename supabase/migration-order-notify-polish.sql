-- Polish the customer-facing order-status messages to a clean, professional
-- tone (no emojis), consistent with the wallet notifications.
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
    -- Daily subscription (milk) delivery.
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
    -- One-off order.
    if NEW.status = 'Packed' then
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
