-- ════════════════════════════════════════════════════════════════════════════
-- Rotate WEBHOOK_SECRET out of committed source.
-- The shared secret (auth for notify-admin/notify-partner + OTP pepper) used to
-- be hard-coded in the notify trigger functions. Move it to a private,
-- PostgREST-inaccessible table that only the SECURITY DEFINER trigger functions
-- (owned by postgres) can read. The actual value is written out-of-band via a
-- one-off query — it is NEVER stored in this file or git.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secret (key text primary key, value text not null);
alter table private.app_secret enable row level security;   -- no policies → no client access
revoke all on private.app_secret from public, anon, authenticated;

-- notify-partner caller: read the secret from the private table, not a literal.
create or replace function public._notify_partner(p_user uuid, p_role text, p_order uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-partner',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'userId', p_user, 'role', p_role,
      'code', (select human_code from public.orders where id = p_order),
      'isCod', (lower(coalesce((select payment_method from public.orders where id = p_order),'')) = 'cod'),
      'total', (select total from public.orders where id = p_order))
  );
exception when others then null;
end; $function$;

-- notify-admin trigger: same.
create or replace function public.notify_admin_new_order()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  if coalesce(NEW.is_return, false) or coalesce(NEW.is_membership, false) or coalesce(NEW.is_topup, false) then
    return NEW;
  end if;
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object('type','INSERT','record', to_jsonb(NEW))
  );
  return NEW;
end; $function$;
