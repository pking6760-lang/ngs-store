-- ════════════════════════════════════════════════════════════════════════════
-- Subscription (milk) orders get their own status messages, distinct from a
-- normal one-off order — so "Delivered" reads like a daily milk drop, not a
-- generic order. Detected by: subscription_id set AND not the plan master.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._notify_order_status()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_title text; v_body text; v_code text; v_sub boolean;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if coalesce(NEW.is_membership,false) or coalesce(NEW.is_topup,false) or coalesce(NEW.is_return,false) then return NEW; end if;
  if NEW.user_id is null then return NEW; end if;
  v_code := coalesce(NEW.human_code, '');
  v_sub := NEW.subscription_id is not null and not coalesce(NEW.is_subscription, false);

  if v_sub then
    -- Daily subscription (milk) wording.
    if NEW.status = 'Packed' then
      v_title := 'Milk packed 🥛'; v_body := 'Your daily delivery (' || v_code || ') is packed and ready.';
    elsif NEW.status = 'Out for delivery' then
      v_title := 'Milk on the way 🥛'; v_body := 'Your daily delivery (' || v_code || ') is on its way to you.';
    elsif NEW.status = 'Delivered' then
      v_title := 'Milk delivered 🥛'; v_body := 'Your daily delivery (' || v_code || ') is at your door. See you tomorrow!';
    elsif NEW.status = 'Cancelled' then
      v_title := 'Delivery skipped'; v_body := 'Today''s subscription delivery (' || v_code || ') was cancelled.';
    else
      return NEW;
    end if;
  else
    -- Normal one-off order wording.
    if NEW.status = 'Packed' then
      v_title := 'Order packed'; v_body := 'Your order ' || v_code || ' is packed and ready to go.';
    elsif NEW.status = 'Out for delivery' then
      v_title := 'On the way'; v_body := 'Your order ' || v_code || ' is out for delivery.';
    elsif NEW.status = 'Delivered' then
      v_title := 'Delivered'; v_body := 'Your order ' || v_code || ' has been delivered. Enjoy!';
    elsif NEW.status = 'Cancelled' then
      v_title := 'Order cancelled'; v_body := 'Your order ' || v_code || ' was cancelled.';
    else
      return NEW;
    end if;
  end if;

  insert into public.notifications (user_id, title, body) values (NEW.user_id, v_title, v_body);
  return NEW;
end; $function$;

select 'subscription delivered message applied' as status;
