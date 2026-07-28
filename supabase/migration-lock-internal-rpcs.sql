-- Close a set of functions that anyone holding the anon key could call.
--
-- FOUND WHILE DOING GRANT HYGIENE ON THE DUE-DELIVERY ALARM. Checking that my
-- own new function was not client-callable showed it had been granted to anon
-- and authenticated anyway -- because Supabase ships this:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--     TO anon, authenticated, service_role;
--
-- So EVERY function ever created in `public` is callable by anyone holding the
-- anon key, and the anon key ships inside the APK. `revoke ... from public`
-- does not undo it: these are explicit role grants, not the PUBLIC grant.
--
-- Three of them were exploitable. All three were reproduced against the live
-- database inside a rolled-back transaction before writing a line of this file.
--
-- 1. _place_order_core(p_uid, ...)   CRITICAL
--    SECURITY DEFINER, trusts its p_uid argument, never calls auth.uid().
--    The public wrapper place_order() passes auth.uid(); the core does not
--    check that anyone did. Proven: as anon -- not logged in at all -- I
--    created order NGS6987 billed to another customer's account, with an
--    address of my choosing and p_enforce_store_open := false. The same call
--    takes p_wallet and p_redeem_points, so it can spend a stranger's wallet
--    balance and loyalty points.
--
-- 2. store_automation_apply(open, rain, peak)   HIGH
--    SECURITY DEFINER, no caller check. Its only guard asks whether the OWNER
--    enabled automation, not who is calling. Proven: as anon I set
--    settings.store_open = false. The shop closes. The same call flips
--    delivery_mode, which is what surge and peak pay hang off.
--
-- 3. _loss_sweep(uuid), _order_scenarios(uuid, uuid)   MODERATE
--    Diagnostics that return per-order cost, margin and profit. Granted to
--    PUBLIC and to anon. Nobody outside the shop should be able to read what
--    the shop pays for its stock.
--
-- Also locked, as plain hygiene rather than proven holes: lifecycle_price_pct
-- (internal pricing input) and _shop_owner_id (identity of the owner account,
-- confirmed to be used by no RLS policy).
--
-- SAFE TO REVOKE: every legitimate caller of these -- place_order,
-- coupon_quote, quote_delivery, call_order_party, run_store_automation -- is
-- itself SECURITY DEFINER and therefore executes as the function owner, which
-- keeps its own EXECUTE right. The client never calls any of them directly;
-- that was verified against the app source and against pg_proc.prosrc.

begin;

revoke all on function public._place_order_core(uuid, jsonb, text, jsonb, text, text, numeric, int, boolean, boolean, text)
  from public, anon, authenticated;

revoke all on function public.store_automation_apply(boolean, boolean)          from public, anon, authenticated;
revoke all on function public.store_automation_apply(boolean, boolean, boolean) from public, anon, authenticated;

revoke all on function public._loss_sweep(uuid)              from public, anon, authenticated;
revoke all on function public._order_scenarios(uuid, uuid)   from public, anon, authenticated;
revoke all on function public.lifecycle_price_pct(uuid)      from public, anon, authenticated;
revoke all on function public._shop_owner_id()               from public, anon, authenticated;

-- The root cause. From here a new function in `public` is private until
-- somebody grants it on purpose. Existing grants are untouched -- default
-- privileges only ever apply to objects created after this runs.
--
-- The cost of this line is that a future client-facing RPC must say so:
--
--     grant execute on function public.my_new_rpc(...) to authenticated;
--
-- Forgetting it breaks that one feature loudly, in testing, with "permission
-- denied for function". That is the failure we want. The alternative -- the
-- behaviour being replaced here -- fails silently and in the customer's favour
-- for years.
alter default privileges in schema public revoke execute on functions from anon, authenticated;

commit;
