-- ════════════════════════════════════════════════════════════════════════════
-- Customer-side security audit fixes (run alongside migration-profile-guard-fix
-- and the COD-membership fix in migration-tier-pricing).
-- ════════════════════════════════════════════════════════════════════════════

-- FIX 1 (CRITICAL): _activate_membership had the Postgres default EXECUTE-to-
-- PUBLIC grant and was never revoked, so any signed-in customer could call it via
-- REST RPC and grant themselves free lifetime Prime. It's an internal helper —
-- only place_order / mark_order_paid / join_membership call it, and those are
-- SECURITY DEFINER (run as the owner), so the revoke doesn't affect them.
revoke execute on function public._activate_membership(uuid, int) from public, anon, authenticated;

-- FIX 2: process_return_refund is admin/return-flow internal; a customer should
-- never call it directly. Its internal callers are SECURITY DEFINER and keep
-- working; lock out direct customer access.
revoke execute on function public.process_return_refund(uuid) from public, anon, authenticated;

-- FIX 3 (info disclosure): ops_config held internal economics (payouts, margins,
-- dispatch tuning) but was readable by ANY signed-in user. Restrict reads to the
-- owner + staff; writes were already admin-only.
drop policy if exists ops_read on public.ops_config;
create policy ops_read on public.ops_config
  for select using (public.is_admin() or public.is_staff());
