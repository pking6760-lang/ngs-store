-- Hide the partner's earning until the job is actually finished.
--
-- Why: showing "you earn ₹18 on this order" BEFORE the task is done invites
-- cherry-picking — a rider sizes up the payout and stalls, passes, or slow-walks
-- the cheap ones. Pay is a flat formula either way, so the number tells them
-- nothing useful up front; it only distorts behaviour. After the work is done
-- it becomes exactly what they need, so it stays fully visible in the wallet /
-- earnings tabs and in the completion card.
--
-- Enforced SERVER-SIDE, not in the app. get_my_task() / get_my_round() only ever
-- return OPEN work (their WHERE clauses exclude packed / delivered / returned),
-- so the earning they carried was ALWAYS a pre-task figure. Both now return 0.
-- Two consequences worth knowing:
--   • Nothing to hide client-side, so there is no payload to sniff, no stale
--     cache, and no way to read it out of the network tab.
--   • Already-installed partner APKs pick the change up with no update: every
--     banner in the app is guarded by `earning > 0`, so a 0 hides them all.
--
-- The post-completion figure comes from get_order_earning(), which reads the
-- wallet ledger — the entry only exists once the money is actually credited, so
-- the function physically cannot leak a pre-task estimate.

begin;

-- 1) Live task — earning suppressed (always pre-completion by construction).
create or replace function public.get_my_task()
returns table(order_id uuid, code text, task_role text, state text, is_cod boolean,
              paid boolean, cod_amount numeric, location jsonb, items jsonb,
              is_return boolean, earning numeric, packed boolean)
language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code,
    case when o.picker_id = v_uid then 'picker' else 'delivery' end,
    case when o.picker_id = v_uid then o.picker_state else o.delivery_state end,
    (lower(coalesce(o.payment_method, '')) = 'cod'),
    (coalesce(o.payment_status,'') = 'paid'),
    case when lower(coalesce(o.payment_method, '')) = 'cod' then o.total else null end,
    case when o.rider_id = v_uid then o.location else null end,
    case when o.picker_id = v_uid or coalesce(o.is_return,false) then
      (select jsonb_agg(jsonb_build_object(
                 'name', oi.name, 'qty', oi.qty,
                 'barcode', coalesce(p.barcode, ''), 'productId', oi.product_id))
         from public.order_items oi
         left join public.products p on p.id = oi.product_id
        where oi.order_id = o.id)
      else null end,
    coalesce(o.is_return, false),
    -- Deliberately 0: the payout is revealed only after the task completes.
    -- Column kept (not dropped) so installed apps keep parsing the row, and
    -- their `earning > 0` guards hide the banner on their own.
    0::numeric,
    (o.status in ('Packed', 'Out for delivery', 'Delivered')
     or coalesce(o.is_return, false)
     or (o.subscription_id is not null and not coalesce(o.is_subscription, false)))
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
     and not (o.subscription_id is not null and not coalesce(o.is_subscription,false))
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $$;

-- 2) Subscription milk round — same rule, same reason (undelivered stops only).
create or replace function public.get_my_round()
returns table(order_id uuid, code text, state text, location jsonb, address text,
              customer text, phone text, items jsonb, earning numeric, total numeric)
language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then return; end if;
  return query
  select o.id, o.human_code, o.delivery_state, o.location, o.address, o.customer_name, null::text,
    (select jsonb_agg(jsonb_build_object('name', oi.name, 'qty', oi.qty))
       from public.order_items oi where oi.order_id = o.id),
    0::numeric,   -- revealed after the stop is delivered, via get_order_earning()
    o.total
  from public.orders o
  where o.rider_id = v_uid
    and o.subscription_id is not null and not coalesce(o.is_subscription,false)
    and o.delivery_state not in ('delivered','returned')
    and o.deliver_on = v_today
  order by o.distance_km asc nulls last, o.human_code;
end; $$;

-- 3) The reveal. Reads the CALLER's own credited earning for one order.
--    • Sums wallet_ledger, so it can only ever return money already banked —
--      an in-flight order has no row and yields 0.
--    • Filtered on partner_id = auth.uid(), so a partner cannot read another
--      partner's payout by passing someone else's order id, and a customer who
--      knows an order id gets 0 (they have no partner ledger rows at all).
--    • Sums rather than picks one row so a corrected/adjusted earning shows the
--      true net, matching the wallet.
create or replace function public.get_order_earning(p_order uuid)
returns numeric
language sql stable security definer set search_path to 'public'
as $$
  select round(coalesce(sum(w.amount), 0), 2)
    from public.wallet_ledger w
   where w.order_id = p_order
     and w.partner_id = auth.uid()
     and w.kind = 'earning';
$$;

revoke all on function public.get_order_earning(uuid) from public, anon;
grant execute on function public.get_order_earning(uuid) to authenticated;

commit;
