-- Two accuracy fixes for the Money screen:
--  1. "All time" was passing 2020-01-01, so per-day figures divided by ~2400
--     days the shop never traded. Clamp the window to the first real order.
--  2. Surface how much of the cost-of-goods is ESTIMATED (products with no
--     buying price fall back to the default margin) so the profit figure is
--     never mistaken for exact when it isn't.
create or replace function public.admin_finance_summary(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_marg numeric; v_start date;
  v_orders int; v_goods numeric; v_fees numeric; v_member numeric; v_refunds numeric;
  v_cogs numeric; v_picker numeric; v_rider numeric;
  v_scratch numeric; v_referral numeric; v_rewards numeric;
  v_exp jsonb; v_exp_total numeric; v_restock numeric; v_opex numeric;
  v_in numeric; v_payout numeric; v_out numeric; v_in_all numeric; v_out_all numeric;
  v_gross numeric; v_op numeric; v_net numeric; v_days int;
  v_lines int; v_lines_est int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Invalid date range.'; end if;
  select coalesce(default_margin_pct, 0.15) into v_marg from public.ops_config where id = 1;

  -- days the shop was actually trading inside this window
  select greatest(p_from, coalesce(min((created_at at time zone 'Asia/Kolkata')::date), p_from))
    into v_start from public.orders;
  v_days := greatest((p_to - least(v_start, p_to)) + 1, 1);

  select
    count(*) filter (where not coalesce(o.is_membership,false) and not coalesce(o.is_topup,false)),
    coalesce(sum(case when coalesce(o.is_membership,false) or coalesce(o.is_topup,false) then 0
                 else greatest(coalesce(o.item_total,0) - coalesce(o.discount,0)
                      - coalesce(o.points_discount,0) - coalesce(o.welcome_discount,0), 0) end), 0),
    coalesce(sum(coalesce(o.delivery_fee,0)+coalesce(o.handling,0)+coalesce(o.surge_fee,0)), 0),
    coalesce(sum(coalesce(o.membership_fee,0)), 0),
    coalesce(sum(coalesce(o.refunded_amount,0)), 0)
  into v_orders, v_goods, v_fees, v_member, v_refunds
  from public.orders o
  where o.status='Delivered' and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(oi.qty * coalesce(pc.cost, oi.price * (1 - v_marg))), 0),
         count(*), count(*) filter (where pc.cost is null or pc.cost <= 0)
    into v_cogs, v_lines, v_lines_est
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.product_costs pc on pc.product_id = oi.product_id
  where o.status='Delivered' and not coalesce(o.is_membership,false) and not coalesce(o.is_topup,false)
    and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(oe.picker_earning),0), coalesce(sum(oe.rider_earning),0)
    into v_picker, v_rider
  from public.order_economics oe join public.orders o on o.id = oe.order_id
  where o.status='Delivered' and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(coalesce(o.scratch_wallet,0)+coalesce(o.member_bonus_wallet,0)),0) into v_scratch
  from public.orders o
  where o.status='Delivered' and (o.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to;

  select coalesce(sum(w.amount),0) into v_referral from public.customer_wallet w
  where w.kind='referral' and w.amount>0
    and (w.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
  v_rewards := round(coalesce(v_scratch,0)+coalesce(v_referral,0),2);

  select coalesce(jsonb_object_agg(k,amt),'{}'::jsonb), coalesce(sum(amt),0) into v_exp, v_exp_total
  from (select kind k, sum(amount) amt from public.business_expenses
         where spent_on between p_from and p_to group by kind) t;
  v_restock := coalesce((v_exp->>'restock')::numeric,0);
  v_opex := round(coalesce(v_exp_total,0)-v_restock,2);

  select coalesce(sum(o.total),0) into v_in from public.orders o
  where coalesce(o.payment_status,'')='paid' and coalesce(o.status,'')<>'Cancelled'
    and (coalesce(o.delivered_at,o.created_at) at time zone 'Asia/Kolkata')::date between p_from and p_to;
  select coalesce(sum(abs(w.amount)),0) into v_payout from public.wallet_ledger w
  where w.kind='payout' and (w.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
  v_out := round(coalesce(v_exp_total,0)+coalesce(v_payout,0),2);

  select coalesce(sum(o.total),0) into v_in_all from public.orders o
  where coalesce(o.payment_status,'')='paid' and coalesce(o.status,'')<>'Cancelled';
  select coalesce((select sum(amount) from public.business_expenses),0)
       + coalesce((select sum(abs(amount)) from public.wallet_ledger where kind='payout'),0) into v_out_all;

  v_gross := round(v_goods - v_cogs, 2);
  v_op := round(v_gross + v_fees + v_member - v_picker - v_rider - v_rewards - v_refunds, 2);
  v_net := round(v_op - v_opex, 2);

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_days, 'trading_from', least(v_start, p_to),
    'sales', jsonb_build_object('orders', v_orders, 'goods', round(v_goods,2), 'fees', round(v_fees,2),
       'membership', round(v_member,2), 'total', round(v_goods+v_fees+v_member,2)),
    'costs', jsonb_build_object('cogs', round(v_cogs,2), 'picker', round(v_picker,2), 'rider', round(v_rider,2),
       'rewards', v_rewards, 'refunds', round(v_refunds,2),
       'total', round(v_cogs+v_picker+v_rider+v_rewards+v_refunds,2),
       'lines', v_lines, 'lines_estimated', v_lines_est),
    'expenses', jsonb_build_object('by_kind', v_exp, 'total', round(coalesce(v_exp_total,0),2),
       'restock', round(v_restock,2), 'running', v_opex),
    'profit', jsonb_build_object('gross', v_gross, 'operating', v_op, 'net', v_net,
       'per_order', case when v_orders>0 then round(v_op/v_orders,2) else 0 end,
       'per_day', round(v_net/v_days,2)),
    'cash', jsonb_build_object('in', round(v_in,2), 'out', v_out, 'net', round(v_in-v_out,2),
       'in_all', round(v_in_all,2), 'out_all', round(v_out_all,2), 'balance_all', round(v_in_all-v_out_all,2),
       'payouts', round(coalesce(v_payout,0),2)),
    'breakeven', jsonb_build_object('daily_running_cost', round(v_opex/v_days,2),
       'orders_needed_per_day', case when v_orders>0 and v_op>0
            then ceil((v_opex/v_days)/(v_op/v_orders)) else null end));
end; $$;
revoke all on function public.admin_finance_summary(date,date) from public, anon;
grant execute on function public.admin_finance_summary(date,date) to authenticated;
