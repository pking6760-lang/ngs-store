-- ════════════════════════════════════════════════════════════════════════════
-- Broadcast a notification to EVERY customer's inbox in one admin action.
--
-- The single-customer send already exists (admin inserts one notifications row
-- via the "notifications admin write" RLS policy). This adds the "notify all"
-- side: one SECURITY DEFINER call fans out a row to every customer so the admin
-- doesn't insert hundreds of rows from the client. Admin-only, and it targets
-- role='customer' only (never staff/partners/admins).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.broadcast_notification(p_title text, p_body text default '')
 returns integer
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can send notifications.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'A title is required.';
  end if;

  insert into public.notifications (user_id, title, body)
    select id, trim(p_title), coalesce(p_body, '')
    from public.profiles
    where role = 'customer';

  get diagnostics v_count = row_count;
  return v_count;   -- how many customers received it
end; $function$;

-- Callable by signed-in users, but the body enforces is_admin(); block anon.
revoke execute on function public.broadcast_notification(text, text) from public, anon;
grant execute on function public.broadcast_notification(text, text) to authenticated;
