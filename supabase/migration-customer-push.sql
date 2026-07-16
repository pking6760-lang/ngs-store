-- ════════════════════════════════════════════════════════════════════════════
-- Customer push notifications.
--   • customer_devices holds each customer's FCM token(s).
--   • Every row inserted into notifications (admin "Notify", broadcast, or an
--     automated order-status message) fires a push to that customer's devices.
--   • Order-status changes (Packed / Out for delivery / Delivered / Cancelled)
--     auto-create a customer notification — which then pushes.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.customer_devices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  fcm_token  text not null unique,
  platform   text default 'android',
  updated_at timestamptz default now()
);
alter table public.customer_devices enable row level security;
revoke all on public.customer_devices from anon;
drop policy if exists cd_own on public.customer_devices;
create policy cd_own on public.customer_devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Save/refresh this customer's device token (upsert; token can move accounts).
create or replace function public.save_customer_token(p_token text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return; end if;
  insert into public.customer_devices (user_id, fcm_token, updated_at)
    values (auth.uid(), p_token, now())
  on conflict (fcm_token) do update set user_id = excluded.user_id, updated_at = now();
end; $function$;
revoke execute on function public.save_customer_token(text) from public, anon;
grant execute on function public.save_customer_token(text) to authenticated;

-- Any notification row → push to that customer's devices (best-effort).
create or replace function public._notify_customer_row()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-customer',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('userId', NEW.user_id, 'title', NEW.title, 'body', coalesce(NEW.body,''))
  );
  return NEW;
exception when others then return NEW;   -- never block the inbox insert
end; $function$;
drop trigger if exists trg_notify_customer on public.notifications;
create trigger trg_notify_customer after insert on public.notifications
  for each row execute function public._notify_customer_row();

-- Order-status change → auto-create a customer notification (which then pushes).
create or replace function public._notify_order_status()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_title text; v_body text; v_code text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if coalesce(NEW.is_membership,false) or coalesce(NEW.is_topup,false) or coalesce(NEW.is_return,false) then return NEW; end if;
  if NEW.user_id is null then return NEW; end if;
  v_code := coalesce(NEW.human_code, '');
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
  insert into public.notifications (user_id, title, body) values (NEW.user_id, v_title, v_body);
  return NEW;
end; $function$;
drop trigger if exists trg_notify_order_status on public.orders;
create trigger trg_notify_order_status after update of status on public.orders
  for each row execute function public._notify_order_status();
