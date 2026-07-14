-- ════════════════════════════════════════════════════════════════════════════
-- DEFENSE-IN-DEPTH: guard privilege/money columns on profile INSERT too.
--
-- Escalation was already blocked (guard freezes columns on UPDATE; the profile
-- row pre-exists so a fake-admin INSERT hits a PK conflict; and there is no
-- DELETE policy so the row can't be cleared and re-inserted). But that safety
-- rests on two IMPLICIT conditions, not an explicit rule: the INSERT RLS policy
-- only checks `id = auth.uid()` and never restricts `role`, and the guard
-- trigger fired on UPDATE only. If a DELETE policy is ever added, or the signup
-- flow ever lets a client create its own row, a customer could INSERT
-- role='admin' and self-promote.
--
-- Make it explicit: on INSERT by a non-admin, force every privilege/money
-- column to its safe default. Legitimate signup (handle_new_user) runs
-- SECURITY DEFINER as the table owner, so current_user is NOT 'authenticated'
-- and it passes through untouched.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.guard_profile_update()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;  -- RPCs / definer / admin role
  if public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    -- A non-admin may only ever create a plain customer row for themselves.
    -- Force every privilege/money/lifecycle column to its safe default; the RLS
    -- INSERT policy already enforces id = auth.uid().
    new.role               := 'customer';
    new.points             := 0;
    new.is_member          := false;
    new.member_since       := null;
    new.member_until       := null;
    new.order_count        := 0;
    new.member_order_count := 0;
    new.membership_count   := 0;
    return new;
  end if;

  -- UPDATE: restore money/lifecycle columns from the existing row.
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

-- Fire the same guard on INSERT as well as UPDATE.
drop trigger if exists guard_profile_insert on public.profiles;
create trigger guard_profile_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_update();
