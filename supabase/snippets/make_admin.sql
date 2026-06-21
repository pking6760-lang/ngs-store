-- =============================================================================
-- Promote an account to admin (Step 3).
--
-- PREREQUISITE: the account must already exist — sign up through the app or via
-- Supabase -> Authentication -> Users first, so the profiles row exists.
--
-- Run in: Supabase -> SQL Editor. Change the email if needed.
-- =============================================================================

update public.profiles
set role = 'admin'
where email = 'pking6760@gmail.com';

-- Verify it worked — should show your row with role = admin:
select id, email, display_name, role, is_premium
from public.profiles
where email = 'pking6760@gmail.com';
