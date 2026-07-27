-- Evaluate the security check once per query instead of once per row.
--
-- A policy like `user_id = auth.uid() or is_admin()` is re-run for EVERY row the
-- query touches, and is_admin() is itself a lookup in profiles. On 70 orders
-- that is invisible; on 200,000 it is 200,000 extra lookups per read, and it was
-- already showing up as 4.7 million sequential scans of profiles.
--
-- Wrapping the call in a scalar sub-select makes Postgres hoist it into an
-- InitPlan: computed once, reused for every row. The rule each policy enforces
-- is character-for-character the same -- this changes only how many times the
-- answer is worked out. Verified after applying: a customer still cannot read
-- another customer's order, and an anonymous session still cannot read any.

begin;

alter policy "admin tokens read" on public.admin_push_tokens using ((select public.is_admin()));
alter policy "admin tokens write" on public.admin_push_tokens using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "calls_sel" on public.calls using ((((select auth.uid()) = caller_id) OR ((select auth.uid()) = callee_id)));
alter policy "cart_own" on public.carts using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "categories admin write" on public.categories using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "cred_admin_read" on public.coupon_redemptions using ((select public.is_admin()));
alter policy "coupons admin write" on public.coupons using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "coupons read active" on public.coupons using ((active OR (select public.is_admin())));
alter policy "addr own delete" on public.customer_addresses using ((user_id = (select auth.uid())));
alter policy "addr own insert" on public.customer_addresses with check ((user_id = (select auth.uid())));
alter policy "addr own select" on public.customer_addresses using ((user_id = (select auth.uid())));
alter policy "addr own update" on public.customer_addresses using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "cd_own" on public.customer_devices using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "themes_admin" on public.customer_themes using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "wallet read own" on public.customer_wallet using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "nc_admin" on public.notification_campaigns using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "nt_admin" on public.notification_templates using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "notifications admin write" on public.notifications with check ((select public.is_admin()));
alter policy "notifications own update" on public.notifications using ((user_id = (select auth.uid())));
alter policy "notifications read own" on public.notifications using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "ops_admin" on public.ops_config using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "ops_read" on public.ops_config using ((select public.is_admin()));
alter policy "oe_admin" on public.order_economics using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "order_items read own" on public.order_items using (((select public.is_admin()) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = (select auth.uid())))))));
alter policy "orders admin update" on public.orders using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "orders read own" on public.orders using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "devices_admin" on public.partner_devices using ((select public.is_admin()));
alter policy "devices_own" on public.partner_devices using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "online_log_admin" on public.partner_online_log using ((select public.is_admin()));
alter policy "presence_admin" on public.partner_presence using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "presence_own" on public.partner_presence using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "slots_admin" on public.partner_slots using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "slots_book" on public.partner_slots with check ((partner_id = (select auth.uid())));
alter policy "slots_read" on public.partner_slots using (((partner_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "strikes_admin" on public.partner_strikes using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "strikes_read" on public.partner_strikes using (((partner_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "partners insert self" on public.partners with check ((user_id = (select auth.uid())));
alter policy "partners read own or admin" on public.partners using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "partners update own or admin" on public.partners using (((select public.is_admin()) OR (user_id = (select auth.uid())))) with check (((select public.is_admin()) OR ((user_id = (select auth.uid())) AND (status = 'pending'::text))));
alter policy "points read own" on public.points_ledger using (((user_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "pricing_config_admin_read" on public.pricing_config using ((select public.is_admin()));
alter policy "pricing_config_admin_write" on public.pricing_config using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "product_costs_admin" on public.product_costs using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "pops_admin" on public.product_ops using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "pops_read" on public.product_ops using ((select public.is_admin()));
alter policy "products admin write" on public.products using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "profiles insert self" on public.profiles with check ((id = (select auth.uid())));
alter policy "profiles read own" on public.profiles using (((id = (select auth.uid())) OR (select public.is_admin())));
alter policy "profiles update own" on public.profiles using (((id = (select auth.uid())) OR (select public.is_admin())));
alter policy "rdc_admin_read" on public.referral_device_claims using ((select public.is_admin()));
alter policy "referrals read own" on public.referrals using (((referrer_id = (select auth.uid())) OR (referee_id = (select auth.uid())) OR (select public.is_admin())));
alter policy "settings admin write" on public.settings using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "sa_own" on public.stock_alerts using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "subs_own" on public.subscriptions using ((user_id = (select auth.uid())));
alter policy "ledger_admin" on public.wallet_ledger using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "ledger_read" on public.wallet_ledger using (((partner_id = (select auth.uid())) OR (select public.is_admin())));

commit;
