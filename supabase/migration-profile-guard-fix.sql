-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY FIX: freeze ALL money/lifecycle columns on profiles against direct
-- customer edits.
--
-- profiles has a broad RLS UPDATE policy (id = auth.uid()) + table UPDATE grant,
-- and RLS is row-level (not column-level), so a customer could UPDATE any column
-- of their own row via the API. The guard trigger blocks this, but it predated
-- the honeymoon columns — a customer could reset order_count / member_order_count
-- / membership_count to keep the deepest "new member" prices forever, or set
-- member_until. Freeze them all. Customers may still change name/phone/address/
-- email. SECURITY DEFINER RPCs run as the definer (current_user <> authenticated),
-- so they bypass this and keep working.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.guard_profile_update()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- RPCs / admin role
  if public.is_admin() then return new; end if;
  -- A customer may only edit contact details; everything money- or lifecycle-
  -- related is restored from the old row here.
  new.points             := old.points;
  new.is_member          := old.is_member;
  new.member_since       := old.member_since;
  new.member_until       := old.member_until;
  new.role               := old.role;
  new.order_count        := old.order_count;
  new.member_order_count := old.member_order_count;
  new.membership_count   := old.membership_count;
  new.customer_code      := old.customer_code;
  return new;
end; $function$;
