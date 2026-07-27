-- Remove the per-item free-delivery and rewards flags.
--
-- Both asked a question that is now answered once, on the whole order, from the
-- money that's actually left after paying the picker, the rider and the stock:
--
--   free delivery  -> granted only if the order still clears min_free_delivery_profit
--   member price   -> can never go below member_price_floor (cost + 7%)
--   points/scratch -> drawn from the giveaway budget, which stops at the shop floor
--
-- So the flags were a second, worse mechanism for the same job. Worse because a
-- per-item flag cannot see quantity: it got ten bottles of oil wrong in one
-- direction and twenty biscuits wrong in the other. They also made the product
-- editor look like it had pricing decisions in it that it did not really own.
--
-- Checked before dropping: member_price_floor already equals the selling price
-- on every thin item, so no_rewards was withholding a discount that could not
-- have been given anyway. v_reward_margin and v_high_margin were computed on
-- every order and never read once -- dead since the budget replaced them.

begin;

drop function if exists public.refresh_free_delivery_exempt();
drop trigger if exists trg_sync_free_delivery_gate on public.ops_config;
drop function if exists public._sync_free_delivery_gate();

alter table public.products
  drop column if exists free_delivery_exempt,
  drop column if exists free_delivery_exempt_auto,
  drop column if exists no_rewards;

alter table public.ops_config
  drop column if exists free_delivery_min_margin_pct,
  drop column if exists free_delivery_min_margin_rupees;

commit;
