-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — lock down the RPC surface.
--
-- Postgres grants EXECUTE on functions to PUBLIC by default, and Supabase
-- exposes anything anon/authenticated can execute as a callable REST RPC. That
-- left ~16 internal helper / trigger / cron functions reachable by anyone with
-- the shipped publishable key — e.g. dispatch_tick(), _notify_partner()
-- (push spam), partner_wallet_balance()/order_pool() (financial info), and
-- smart_reprice() (force a full catalog reprice).
--
-- These are only ever meant to run INTERNALLY (called by other SECURITY DEFINER
-- functions, by triggers, or by pg_cron as postgres) — never straight from a
-- client. Internal / trigger / cron calls run as the function OWNER, so revoking
-- EXECUTE from anon/authenticated does NOT break them; it only removes them from
-- the public RPC surface.
--
-- The guarded, client-facing RPCs (place_order, book_slot, partner_*, admin_*,
-- advance_order_status, rate_order, redeem_points, get_my_*, set_online,
-- save_*_token, set_partner_status, slot_counts) are left untouched, as are the
-- RLS helpers is_admin()/is_staff() (needed during row-level-security checks).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. smart_reprice: make it safe-update compatible ────────────────────────
-- The `authenticator` role preloads the `safeupdate` extension, which blocks
-- UPDATE/DELETE without a WHERE clause. smart_reprice had one bare update
-- (`set bait = false`), so it could only ever run from pg_cron (as postgres) —
-- the admin's manual "recompute" and price-on-cost-save were silently failing.
-- Give that update a WHERE clause; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.smart_reprice()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg public.pricing_config;
begin
  select * into cfg from public.pricing_config where id = 1;
  if cfg is null or not cfg.enabled then return; end if;

  insert into public.product_costs (product_id)
    select id from public.products on conflict (product_id) do nothing;

  with sales as (
    select oi.product_id as pid,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '1 day'),  0)::int as d1,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '3 days'), 0)::int as d3,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '7 days'), 0)::int as d7,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '14 days'),0)::int as d14,
      coalesce(sum(oi.qty) filter (where o.created_at >= now() - interval '30 days'),0)::int as d30
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'Cancelled' and o.created_at >= now() - interval '30 days'
    group by oi.product_id
  ),
  scored as (
    select p.id, pc.cost, p.mrp, p.created_at,
      coalesce(s.d1,0) d1, coalesce(s.d3,0) d3, coalesce(s.d7,0) d7,
      coalesce(s.d14,0) d14, coalesce(s.d30,0) d30,
      round(30.0 * (
        4*coalesce(s.d1,0)/1.0 + 3*coalesce(s.d3,0)/3.0 + 3*coalesce(s.d7,0)/7.0
        + 2*coalesce(s.d14,0)/14.0 + 1*coalesce(s.d30,0)/30.0
      ) / 13.0)::int as vscore
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    left join sales s on s.pid = p.id
  ),
  calc as (
    select *,
      case
        when cost is null or mrp is null or mrp < cost then 'unpriced'
        when d30 = 0 and created_at < now() - interval '30 days' then 'dead'
        when d30 between 1 and cfg.slow_max then 'slow'
        when vscore >= cfg.fast_min then 'fast'
        else 'steady'
      end as tier
    from scored
  ),
  priced as (
    select *,
      case tier
        when 'unpriced' then null
        when 'dead'   then round(cost * (1 + cfg.clearance_markup))
        when 'fast'   then round(cost / (1 - cfg.fast_margin))
        when 'slow'   then round(cost / (1 - cfg.slow_margin))
        else               round(cost / (1 - cfg.steady_margin))
      end as raw
    from calc
  ),
  priv as (
    update public.product_costs pc set
      speed_tier = pr.tier, units_30d = pr.d30, velocity_score = pr.vscore,
      sold_1d = pr.d1, sold_3d = pr.d3, sold_7d = pr.d7, sold_14d = pr.d14, sold_30d = pr.d30
    from priced pr where pc.product_id = pr.id
    returning pr.id, pr.tier, pr.raw, pr.cost, pr.mrp, pr.vscore
  )
  update public.products p set
    price = case when priv.tier = 'unpriced' then p.price
                 else least(greatest(least(priv.raw, priv.mrp), ceil(priv.cost * (1 + cfg.floor_markup))), priv.mrp)
            end,
    hot = (priv.vscore >= cfg.fast_min),
    auto_priced_at = case when priv.tier = 'unpriced' then p.auto_priced_at else now() end
  from priv where p.id = priv.id;

  -- Bulk tiers from the freshly-set price (priced products only).
  update public.products p set
    bulk_tiers = public.build_bulk_tiers(p.price, ceil(pc.cost * (1 + cfg.floor_markup)), cfg)
    from public.product_costs pc
    where pc.product_id = p.id and pc.cost is not null and pc.speed_tier <> 'unpriced';
  update public.products p set bulk_tiers = '[]'::jsonb
    from public.product_costs pc
    where pc.product_id = p.id and (pc.cost is null or pc.speed_tier = 'unpriced');

  update public.products set bait = false where bait;  -- WHERE keeps safeupdate happy
  update public.products p set bait = true
    from public.product_costs pc where pc.product_id = p.id and pc.bait_override = 'pin';
  with cand as (
    select pc.product_id from public.product_costs pc
    join public.products p on p.id = pc.product_id
    where pc.speed_tier = 'fast' and p.active and coalesce(pc.bait_override, '') <> 'hide'
    order by pc.velocity_score desc, pc.units_30d desc
    limit greatest(cfg.bait_count, 0)
  )
  update public.products p set bait = true from cand where p.id = cand.product_id;
end; $function$;

-- ── 2. Admin-guarded wrapper for manual "recompute now" ─────────────────────
-- The client triggers this; anon/regular users are rejected; pg_cron keeps
-- calling smart_reprice() directly.
create or replace function public.admin_smart_reprice()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
  perform public.smart_reprice();
end;
$function$;

-- ── 3. Revoke the internal / helper / trigger / cron functions from clients ──
do $$
declare
  fn record;
  targets text[] := array[
    '_ensure_pool','_notify_partner','dispatch_order','dispatch_tick',
    'handle_new_user','notify_admin_new_order','order_compute_margin','order_pool',
    'partner_cash_in_hand','partner_wallet_balance','pick_partner','slot_sweep',
    'sync_ops_to_settings','trg_dispatch','assign_order','smart_reprice'
  ];
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(targets)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- ── 4. Grant the admin wrapper to logged-in users (guard does the gatekeeping)
revoke execute on function public.admin_smart_reprice() from public, anon;
grant execute on function public.admin_smart_reprice() to authenticated;
