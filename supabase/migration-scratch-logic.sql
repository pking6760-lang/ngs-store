alter table public.orders add column if not exists scratch_points int not null default 0;
alter table public.orders add column if not exists scratch_wallet numeric not null default 0;

-- Grant the scratch reward: the points held back from this order + a small
-- wallet-cash cut of its big-margin items. Both were computed at order time and
-- come out of margin already earned. Idempotent per order.
create or replace function public.claim_scratch_reward(p_order uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare o public.orders; v_pts int; v_cash numeric; v_reward jsonb;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.user_id <> auth.uid() then raise exception 'Order not found.'; end if;
  if o.status <> 'Delivered' then raise exception 'You can scratch after delivery.'; end if;
  if o.is_return then raise exception 'No reward on a return.'; end if;
  if coalesce(o.scratch_claimed, false) then
    return coalesce(o.scratch_reward, jsonb_build_object('points',0,'wallet',0));
  end if;

  v_pts  := greatest(coalesce(o.scratch_points, 0), 0);
  v_cash := greatest(coalesce(o.scratch_wallet, 0), 0);
  v_reward := jsonb_build_object('points', v_pts, 'wallet', v_cash);

  update public.orders set scratch_claimed = true, scratch_reward = v_reward where id = p_order;

  if v_pts > 0 then
    update public.profiles set points = points + v_pts where id = o.user_id;
    insert into public.points_ledger (user_id, order_id, delta, reason)
      values (o.user_id, o.id, v_pts, 'Scratch reward on ' || o.human_code);
  end if;
  if v_cash > 0 then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (o.user_id, v_cash, 'reward', 'Scratch reward on ' || o.human_code, o.id, o.user_id);
  end if;
  return v_reward;
end $function$;
grant execute on function public.claim_scratch_reward(uuid) to authenticated;

-- Default scratch config (merged into settings.rewards).
update public.settings
   set rewards = coalesce(rewards, '{}'::jsonb) || jsonb_build_object(
     'scratch', coalesce(rewards->'scratch', jsonb_build_object(
       'enabled', true,
       'pointsSharePct', 30,
       'highMarginRupees', 20,
       'walletCutPct', 10,
       'walletMaxRupees', 8,
       'minOrder', 0
     )))
 where id = 1;
