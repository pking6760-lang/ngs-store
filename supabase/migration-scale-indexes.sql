-- Indexes for the paths every screen actually uses.
--
-- Measured before writing this: 16 foreign keys had no index behind them, and
-- pg_stat_user_tables showed order_items alone taking 1.13 MILLION sequential
-- scans reading 86 million rows -- on a 76-row table. That is free today and
-- fatal later, because a sequential scan costs exactly as much as the table is
-- big. At 100,000 order lines every "show me this order" reads all 100,000.
--
-- The tables are small right now, so these build instantly. Doing it later means
-- CREATE INDEX CONCURRENTLY and a maintenance window; doing it now costs nothing.
-- That is the whole reason it's being done today.

begin;

-- Order detail, the picker screen, the invoice: all of them look up lines by
-- order. This is the single most important index in the database.
create index if not exists idx_order_items_order on public.order_items (order_id);
-- "What else did people buy with this?" (the attach engine) and per-product
-- sales history walk it the other way.
create index if not exists idx_order_items_product on public.order_items (product_id);

-- "My orders", newest first -- one index serves both the filter and the sort.
create index if not exists idx_orders_user_created on public.orders (user_id, created_at desc);
-- The admin ops list and every dashboard range query.
create index if not exists idx_orders_created on public.orders (created_at desc);
-- The live queue. Partial, so it stays tiny no matter how many orders exist:
-- only the handful that are still moving are in it.
create index if not exists idx_orders_active on public.orders (status, created_at desc)
  where status not in ('Delivered', 'Cancelled', 'Payment failed');
create index if not exists idx_orders_return_of on public.orders (return_of) where return_of is not null;

-- The notification bell, newest first.
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);

-- Points history and the "did this order already earn points?" check.
create index if not exists idx_points_user on public.points_ledger (user_id, created_at desc);
create index if not exists idx_points_order on public.points_ledger (order_id);

-- Push tokens: read on every send, one row per device.
create index if not exists idx_customer_devices_user on public.customer_devices (user_id);
create index if not exists idx_admin_push_user on public.admin_push_tokens (user_id);

-- Coupon abuse checks run on every checkout.
create index if not exists idx_coupon_red_user on public.coupon_redemptions (user_id);

-- Catalogue browsing. Partial on active: sold-out and hidden products are dead
-- weight in the index otherwise.
create index if not exists idx_products_category on public.products (category) where active;

-- Back-in-stock alerts, reorder reminders, referrals, sponsorship, expenses.
create index if not exists idx_stock_alerts_product on public.stock_alerts (product_id);
create index if not exists idx_reorder_sends_product on public.reorder_sends (product_id);
create index if not exists idx_referrals_referrer on public.referrals (referrer_id);
create index if not exists idx_rdc_referee on public.referral_device_claims (referee_id);
create index if not exists idx_sponsorship_order on public.sponsorship_ledger (order_id);
create index if not exists idx_bexp_staff on public.business_expenses (staff_id);
create index if not exists idx_subs_user on public.subscriptions (user_id);

commit;

analyze;
