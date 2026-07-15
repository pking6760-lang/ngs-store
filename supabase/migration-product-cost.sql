-- Per-product cost price (what the shop pays the distributor). Enables real
-- margin figures in the product editor and, later, accurate partner margin-
-- share payouts. Optional column — existing products keep cost = null until set.
alter table public.products
  add column if not exists cost numeric(10,2) check (cost is null or cost >= 0);
