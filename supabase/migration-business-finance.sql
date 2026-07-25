-- ═══════════════════════════════════════════════════════════════════════════
--  Business finance: expenses, salaried staff, and a real P&L / cash view.
--
--  SECURITY MODEL (money data — the most sensitive in the app):
--    • Both new tables have RLS enabled with NO permissive policy, and ALL
--      table privileges are revoked from anon AND authenticated. Nothing can
--      read or write them directly through PostgREST — not a customer, not a
--      partner, not an anonymous caller.
--    • Every access goes through a SECURITY DEFINER function whose FIRST
--      statement is an is_admin() gate, with search_path pinned to 'public'
--      so it cannot be hijacked by a rogue schema.
--    • EXECUTE is revoked from public/anon on every function; only
--      'authenticated' may call, and the is_admin() gate then does the real work.
--    • Amounts and kinds are constrained at the table level, so even a bug in
--      the UI cannot store a negative or unknown expense.
--    • created_by records who spent what (audit trail).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── salaried staff (co-admin / helper) ───────────────────────────────────────
-- Distinct from public.partners: partners (picker/rider) are paid per task out
-- of order economics; these people are paid a fixed monthly wage.
create table if not exists public.staff_members (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 80),
  role           text not null default 'helper'
                 check (role in ('co-admin','helper','cashier','stocker','cleaner','other')),
  phone          text check (phone is null or phone ~ '^[0-9]{10}$'),
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0 and monthly_salary <= 10000000),
  active         boolean not null default true,
  started_on     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  note           text check (note is null or length(note) <= 300),
  created_at     timestamptz not null default now()
);

-- ── every rupee that leaves the business ─────────────────────────────────────
create table if not exists public.business_expenses (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in
               ('rent','electricity','salary','restock','packaging','transport',
                'marketing','maintenance','internet','repairs','licence','other')),
  amount     numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  note       text check (note is null or length(note) <= 300),
  spent_on   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  staff_id   uuid references public.staff_members(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_bexp_spent_on on public.business_expenses (spent_on);
create index if not exists idx_bexp_kind     on public.business_expenses (kind, spent_on);

-- ── lock both tables down completely ─────────────────────────────────────────
alter table public.staff_members     enable row level security;
alter table public.business_expenses enable row level security;
-- no policies at all => RLS denies everything; and no grants => PostgREST 401s.
revoke all on public.staff_members     from anon, authenticated;
revoke all on public.business_expenses from anon, authenticated;

-- ═══════════ staff ═══════════════════════════════════════════════════════════
create or replace function public.admin_save_staff(
  p_id uuid, p_name text, p_role text, p_phone text,
  p_salary numeric, p_active boolean, p_note text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid; v_phone text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  v_phone := nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '');
  if v_phone is not null and length(v_phone) <> 10 then
    raise exception 'Phone must be 10 digits.';
  end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'Name is required.'; end if;

  if p_id is null then
    insert into public.staff_members (name, role, phone, monthly_salary, active, note)
    values (btrim(p_name), coalesce(p_role,'helper'), v_phone,
            greatest(coalesce(p_salary,0),0), coalesce(p_active,true), nullif(btrim(p_note),''))
    returning id into v_id;
  else
    update public.staff_members
       set name = btrim(p_name), role = coalesce(p_role, role), phone = v_phone,
           monthly_salary = greatest(coalesce(p_salary,0),0),
           active = coalesce(p_active, active), note = nullif(btrim(p_note),'')
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Staff member not found.'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.admin_list_staff()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.active desc, s.name), '[]'::jsonb)
    into v from public.staff_members s;
  return v;
end; $$;

create or replace function public.admin_delete_staff(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  -- Keep history: never orphan a paid-salary record, just deactivate.
  update public.staff_members set active = false where id = p_id;
end; $$;

-- ═══════════ expenses ════════════════════════════════════════════════════════
create or replace function public.admin_add_expense(
  p_kind text, p_amount numeric, p_note text default null,
  p_spent_on date default null, p_staff uuid default null)
returns bigint
language plpgsql security definer set search_path to 'public'
as $$
declare v_id bigint; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if p_amount > 10000000 then raise exception 'That amount looks wrong — please check it.'; end if;
  -- A dated-in-the-future expense would silently distort every report.
  if coalesce(p_spent_on, v_today) > v_today then
    raise exception 'You can''t record an expense for a future date.';
  end if;
  insert into public.business_expenses (kind, amount, note, spent_on, staff_id, created_by)
  values (p_kind, round(p_amount, 2), nullif(btrim(p_note),''),
          coalesce(p_spent_on, v_today), p_staff, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_delete_expense(p_id bigint)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.business_expenses where id = p_id;
end; $$;

create or replace function public.admin_list_expenses(p_from date, p_to date, p_limit int default 300)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select coalesce(jsonb_agg(x order by x.spent_on desc, x.id desc), '[]'::jsonb) into v
  from (
    select e.id, e.kind, e.amount, e.note, e.spent_on, e.staff_id, s.name as staff_name
      from public.business_expenses e
      left join public.staff_members s on s.id = e.staff_id
     where e.spent_on between p_from and p_to
     order by e.spent_on desc, e.id desc
     limit greatest(1, least(coalesce(p_limit,300), 1000))
  ) x;
  return v;
end; $$;

-- ═══════════ the numbers ═════════════════════════════════════════════════════
-- One call returns the whole picture for a date window:
--   sales → what the goods sold for, plus fees and membership income
--   costs → what those goods cost you, staff-per-task pay, rewards, refunds
--   expenses → rent / electricity / salary / restock / …
--   profit → gross, operating and net
--   cash  → money in vs money out, for the window AND all-time
create or replace function public.admin_finance_summary(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_marg numeric;
  v_orders int; v_goods numeric; v_fees numeric; v_member numeric; v_refunds numeric;
  v_cogs numeric; v_picker numeric; v_rider numeric;
  v_scratch numeric; v_referral numeric; v_rewards numeric;
  v_exp jsonb; v_exp_total numeric; v_restock numeric; v_opex numeric;
  v_in numeric; v_payout numeric; v_out numeric;
  v_in_all numeric; v_out_all numeric;
  v_gross numeric; v_op numeric; v_net numeric;
  v_days int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range.';
  end if;
  select coalesce(default_margin_pct, 0.15) into v_marg from public.ops_config where id = 1;
  v_days := greatest((p_to - p_from) + 1, 1);

  -- ── sales (delivered, real fulfilment orders) ──
  select
    count(*) filter (where not coalesce(o.is_membership,false) and not coalesce(o.is_topup,false)),
    coalesce(sum(case when coalesce(o.is_membership,false) or coalesce(o.is_topup,false) then 0
                 else greatest(coalesce(o.item_total,0) - coalesce(o.discount,0)
                               - coalesce(o.points_discount,0) - coalesce(o.welcome_discount,0), 0) end), 0),
    coalesce(sum(coalesce(o.delivery_fee,0) + coalesce(o.handling,0) + coalesce(o.surge_fee,0)), 0),
    coalesce(sum(coalesce(o.membership_fee,0)), 0),
    coalesce(sum(coalesce(o.refunded_amount,0)), 0)
  into v_orders, v_goods, v_fees, v_member, v_refunds
  from public.orders o
  where o.status = 'Delivered'
    and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  -- ── what those goods cost (falls back to the default margin when a product
  --    has no buying price recorded, so COGS is never silently understated) ──
  select coalesce(sum(oi.qty * coalesce(pc.cost, oi.price * (1 - v_marg))), 0)
    into v_cogs
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.product_costs pc on pc.product_id = oi.product_id
  where o.status = 'Delivered'
    and not coalesce(o.is_membership,false) and not coalesce(o.is_topup,false)
    and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  -- ── per-task staff pay booked against those orders ──
  select coalesce(sum(oe.picker_earning),0), coalesce(sum(oe.rider_earning),0)
    into v_picker, v_rider
  from public.order_economics oe
  join public.orders o on o.id = oe.order_id
  where o.status = 'Delivered'
    and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  -- ── rewards actually given away (wallet money leaving the business) ──
  select coalesce(sum(coalesce(o.scratch_wallet,0) + coalesce(o.member_bonus_wallet,0)), 0)
    into v_scratch
  from public.orders o
  where o.status = 'Delivered'
    and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(w.amount), 0) into v_referral
  from public.customer_wallet w
  where w.kind = 'referral' and w.amount > 0
    and (w.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  v_rewards := round(coalesce(v_scratch,0) + coalesce(v_referral,0), 2);

  -- ── expenses in the window, grouped ──
  select coalesce(jsonb_object_agg(k, amt), '{}'::jsonb), coalesce(sum(amt), 0)
    into v_exp, v_exp_total
  from (select kind as k, sum(amount) as amt
          from public.business_expenses
         where spent_on between p_from and p_to
         group by kind) t;
  v_restock := coalesce((v_exp->>'restock')::numeric, 0);
  v_opex    := round(coalesce(v_exp_total,0) - v_restock, 2);   -- running costs only

  -- ── cash flow (restock IS cash out, even though it isn't a P&L expense) ──
  select coalesce(sum(o.total), 0) into v_in
  from public.orders o
  where coalesce(o.payment_status,'') = 'paid' and coalesce(o.status,'') <> 'Cancelled'
    and (coalesce(o.delivered_at, o.created_at) at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(abs(w.amount)), 0) into v_payout
  from public.wallet_ledger w
  where w.kind = 'payout'
    and (w.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  v_out := round(coalesce(v_exp_total,0) + coalesce(v_payout,0), 2);

  select coalesce(sum(o.total),0) into v_in_all
  from public.orders o
  where coalesce(o.payment_status,'') = 'paid' and coalesce(o.status,'') <> 'Cancelled';
  select coalesce((select sum(amount) from public.business_expenses), 0)
       + coalesce((select sum(abs(amount)) from public.wallet_ledger where kind = 'payout'), 0)
    into v_out_all;

  -- ── profit ──
  v_gross := round(v_goods - v_cogs, 2);                                   -- goods margin
  v_op    := round(v_gross + v_fees + v_member - v_picker - v_rider
                   - v_rewards - v_refunds, 2);                            -- after order costs
  v_net   := round(v_op - v_opex, 2);                                      -- after running costs

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_days,
    'sales', jsonb_build_object(
       'orders', v_orders, 'goods', round(v_goods,2), 'fees', round(v_fees,2),
       'membership', round(v_member,2), 'total', round(v_goods + v_fees + v_member, 2)),
    'costs', jsonb_build_object(
       'cogs', round(v_cogs,2), 'picker', round(v_picker,2), 'rider', round(v_rider,2),
       'rewards', v_rewards, 'refunds', round(v_refunds,2),
       'total', round(v_cogs + v_picker + v_rider + v_rewards + v_refunds, 2)),
    'expenses', jsonb_build_object(
       'by_kind', v_exp, 'total', round(coalesce(v_exp_total,0),2),
       'restock', round(v_restock,2), 'running', v_opex),
    'profit', jsonb_build_object(
       'gross', v_gross, 'operating', v_op, 'net', v_net,
       'per_order', case when v_orders > 0 then round(v_op / v_orders, 2) else 0 end,
       'per_day', round(v_net / v_days, 2)),
    'cash', jsonb_build_object(
       'in', round(v_in,2), 'out', v_out, 'net', round(v_in - v_out, 2),
       'in_all', round(v_in_all,2), 'out_all', round(v_out_all,2),
       'balance_all', round(v_in_all - v_out_all, 2)),
    -- how much profit per order is needed each day just to cover running costs
    'breakeven', jsonb_build_object(
       'daily_running_cost', round(v_opex / v_days, 2),
       'orders_needed_per_day',
         case when v_orders > 0 and v_op > 0
              then ceil((v_opex / v_days) / (v_op / v_orders))
              else null end)
  );
end; $$;

-- ── top products by profit, so restocking follows the money ──────────────────
create or replace function public.admin_top_products(p_from date, p_to date, p_limit int default 10)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb; v_marg numeric;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select coalesce(default_margin_pct, 0.15) into v_marg from public.ops_config where id = 1;
  select coalesce(jsonb_agg(t order by t.profit desc), '[]'::jsonb) into v
  from (
    select oi.name,
           sum(oi.qty)::int                                              as units,
           round(sum(oi.qty * oi.price), 2)                              as revenue,
           round(sum(oi.qty * (oi.price - coalesce(pc.cost, oi.price * (1 - v_marg)))), 2) as profit
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.product_costs pc on pc.product_id = oi.product_id
     where o.status = 'Delivered'
       and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     group by oi.name
     order by profit desc
     limit greatest(1, least(coalesce(p_limit,10), 50))
  ) t;
  return v;
end; $$;

-- ── a customer's wallet history, for the admin customer profile ──────────────
create or replace function public.admin_customer_wallet_history(p_user uuid, p_limit int default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_user is null then raise exception 'Customer required.'; end if;
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v
  from (
    select w.id, w.amount, w.kind, w.note, w.created_at, o.human_code as order_code
      from public.customer_wallet w
      left join public.orders o on o.id = w.order_id
     where w.user_id = p_user
     order by w.created_at desc
     limit greatest(1, least(coalesce(p_limit,100), 500))
  ) t;
  return v;
end; $$;

-- ═══════════ execute grants: authenticated only, is_admin() does the gating ══
do $$
declare r record;
begin
  for r in select oid::regprocedure::text as sig from pg_proc where proname in (
      'admin_save_staff','admin_list_staff','admin_delete_staff',
      'admin_add_expense','admin_delete_expense','admin_list_expenses',
      'admin_finance_summary','admin_top_products','admin_customer_wallet_history')
  loop
    execute 'revoke all on function ' || r.sig || ' from public';
    execute 'revoke all on function ' || r.sig || ' from anon';
    execute 'grant execute on function ' || r.sig || ' to authenticated';
  end loop;
end $$;
