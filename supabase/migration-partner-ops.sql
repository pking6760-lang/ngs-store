-- ═══════════════════════════════════════════════════════════════════════════
-- NGS Partner — Phase 0: operations & payout engine (server foundation)
-- Rate config · product cost/barcode · order assignment · slots · wallet
-- ledger · penalties · device tokens. Everything the partner app plugs into.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ops config — one row of dials the owner controls from admin ──────────
create table if not exists public.ops_config (
  id                        int primary key default 1,
  constraint ops_singleton  check (id = 1),
  -- customer charges
  default_margin_pct        numeric not null default 0.15,
  handling_fee              numeric not null default 10,
  delivery_fee              numeric not null default 20,
  free_delivery_threshold   numeric not null default 199,
  surge_fee                 numeric not null default 25,
  surge_on                  boolean not null default false,
  cod_customer_limit        numeric not null default 1000,   -- carts above → online only
  -- rider payout (share of pool, tapered, floored)
  rider_tier1_pct           numeric not null default 0.40,
  rider_tier2_pct           numeric not null default 0.20,
  rider_taper_break         numeric not null default 100,
  rider_floor               numeric not null default 18,
  -- picker payout
  picker_tier1_pct          numeric not null default 0.20,
  picker_tier2_pct          numeric not null default 0.10,
  picker_taper_break        numeric not null default 100,
  picker_slot_min           numeric not null default 100,
  -- cash control
  rider_cash_cap            numeric not null default 1000,   -- max cash-in-hand a rider may hold
  -- dispatch
  dispatch_stagger_seconds  int not null default 7,          -- picker rings, then delivery
  assignment_timeout_seconds int not null default 30,        -- unaccepted → roll to next
  coverage_picking          text not null default 'me' check (coverage_picking in ('me','staff')),
  coverage_delivery         text not null default 'me' check (coverage_delivery in ('me','staff')),
  -- penalties (strike ladder)
  penalty_fine_2            numeric not null default 50,
  penalty_fine_3            numeric not null default 100,
  penalty_block_days        int not null default 2,
  -- store hours (2-hour slot grid activates within these; future 24h = 0..24)
  store_open_hour           int not null default 6,
  store_close_hour          int not null default 23,
  updated_at                timestamptz not null default now()
);
insert into public.ops_config (id) values (1) on conflict (id) do nothing;

-- ── 2. Private product ops — cost & barcode, NEVER exposed to customers ─────
create table if not exists public.product_ops (
  product_id  text primary key references public.products(id) on delete cascade,
  barcode     text unique,
  cost_price  numeric,          -- absent → fall back to default_margin_pct
  updated_at  timestamptz not null default now()
);

-- ── 3. Orders — assignment, state, and computed earnings ────────────────────
alter table public.orders
  add column if not exists picker_id          uuid,
  add column if not exists rider_id           uuid,
  add column if not exists picker_state       text not null default 'unassigned',
  add column if not exists delivery_state     text not null default 'unassigned',
  add column if not exists picker_assigned_at timestamptz,
  add column if not exists rider_assigned_at  timestamptz,
  add column if not exists packed_at          timestamptz,
  add column if not exists picked_at          timestamptz,
  add column if not exists delivered_at        timestamptz,
  add column if not exists order_margin       numeric,
  add column if not exists pool               numeric,
  add column if not exists picker_earning     numeric,
  add column if not exists rider_earning      numeric;

create index if not exists idx_orders_picker on public.orders(picker_id);
create index if not exists idx_orders_rider  on public.orders(rider_id);

-- ── 4. Slots — 2-hour bookings (no cancel; capacity enforced in booking fn) ─
create table if not exists public.partner_slots (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null,
  role         text not null check (role in ('picker','delivery')),
  slot_date    date not null,
  start_hour   int  not null check (start_hour >= 0 and start_hour <= 22 and start_hour % 2 = 0),
  status       text not null default 'booked' check (status in ('booked','fulfilled','missed','cancelled')),
  fulfilled_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (partner_id, slot_date, start_hour)
);
create index if not exists idx_slots_grid on public.partner_slots(slot_date, start_hour, role, status);

-- ── 5. Wallet ledger — the money truth. Double-entry, always squares ────────
--   amount     : signed effect on what the shop owes the partner (+ credit / − debit)
--   cash_delta : signed effect on cash-in-hand the partner owes the shop (+ up / − down)
create table if not exists public.wallet_ledger (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null,
  order_id   uuid references public.orders(id) on delete set null,
  kind       text not null check (kind in
              ('earning','cod_collected','cod_deposited','payout','penalty','slot_topup','adjustment')),
  amount     numeric not null default 0,
  cash_delta numeric not null default 0,
  note       text,
  confirmed  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_ledger_partner on public.wallet_ledger(partner_id, created_at);
create index if not exists idx_ledger_order   on public.wallet_ledger(order_id);

-- ── 6. Strikes — reliability record feeding the penalty ladder ──────────────
create table if not exists public.partner_strikes (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null,
  reason     text not null check (reason in ('slot_no_show','dodged_order')),
  order_id   uuid,
  slot_id    uuid,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_strikes_partner on public.partner_strikes(partner_id, created_at);

-- ── 7. Device tokens — for FCM hard-alarm push ──────────────────────────────
create table if not exists public.partner_devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  fcm_token  text not null unique,
  platform   text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_devices_user on public.partner_devices(user_id);

-- ── 8. Core money helpers ───────────────────────────────────────────────────
-- Tapered share: full t1 up to the break, gentler t2 above — no ceiling.
create or replace function public.taper(pool numeric, t1 numeric, t2 numeric, brk numeric)
  returns numeric language sql immutable as $$
  select case when coalesce(pool,0) <= brk then coalesce(pool,0) * t1
              else brk * t1 + (pool - brk) * t2 end;
$$;

create or replace function public.partner_wallet_balance(p_user uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.wallet_ledger where partner_id = p_user;
$$;

-- Cash the partner is currently holding for the shop (must stay under the cap).
create or replace function public.partner_cash_in_hand(p_user uuid)
  returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cash_delta), 0) from public.wallet_ledger where partner_id = p_user;
$$;

-- ── 9. Row-level security ───────────────────────────────────────────────────
alter table public.ops_config     enable row level security;
alter table public.product_ops    enable row level security;
alter table public.partner_slots  enable row level security;
alter table public.wallet_ledger  enable row level security;
alter table public.partner_strikes enable row level security;
alter table public.partner_devices enable row level security;

-- ops_config: any signed-in user may read the rates; only admin writes.
drop policy if exists ops_read  on public.ops_config;
drop policy if exists ops_admin on public.ops_config;
create policy ops_read  on public.ops_config for select using (auth.uid() is not null);
create policy ops_admin on public.ops_config for all using (public.is_admin()) with check (public.is_admin());

-- product_ops: staff/admin read (pickers scan), admin writes. Never anon/customer.
drop policy if exists pops_read  on public.product_ops;
drop policy if exists pops_admin on public.product_ops;
create policy pops_read  on public.product_ops for select using (public.is_staff() or public.is_admin());
create policy pops_admin on public.product_ops for all using (public.is_admin()) with check (public.is_admin());

-- slots: a partner sees & books only their own; NO update/delete (can't cancel). Admin full.
drop policy if exists slots_read  on public.partner_slots;
drop policy if exists slots_book  on public.partner_slots;
drop policy if exists slots_admin on public.partner_slots;
create policy slots_read  on public.partner_slots for select using (partner_id = auth.uid() or public.is_admin());
create policy slots_book  on public.partner_slots for insert with check (partner_id = auth.uid());
create policy slots_admin on public.partner_slots for all using (public.is_admin()) with check (public.is_admin());

-- wallet: partner reads own only; writes go through SECURITY DEFINER fns / admin.
drop policy if exists ledger_read  on public.wallet_ledger;
drop policy if exists ledger_admin on public.wallet_ledger;
create policy ledger_read  on public.wallet_ledger for select using (partner_id = auth.uid() or public.is_admin());
create policy ledger_admin on public.wallet_ledger for all using (public.is_admin()) with check (public.is_admin());

-- strikes: partner reads own; admin manages.
drop policy if exists strikes_read  on public.partner_strikes;
drop policy if exists strikes_admin on public.partner_strikes;
create policy strikes_read  on public.partner_strikes for select using (partner_id = auth.uid() or public.is_admin());
create policy strikes_admin on public.partner_strikes for all using (public.is_admin()) with check (public.is_admin());

-- devices: a user manages only their own tokens; admin may read.
drop policy if exists devices_own   on public.partner_devices;
drop policy if exists devices_admin on public.partner_devices;
create policy devices_own   on public.partner_devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy devices_admin on public.partner_devices for select using (public.is_admin());
