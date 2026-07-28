-- Cancelling an order must let go of the partner who was on it.
--
-- THE BUG (order NGS6991). The owner cancelled a packing order. The picker's
-- app kept showing "Scan every item to pack" for it. Two reasons, and the
-- second is the dangerous one:
--
--   1. get_my_task() returns any order where the caller is the picker and
--      picker_state <> 'packed'. It never checked status, so a CANCELLED order
--      the picker had accepted still came back as their current task.
--
--   2. On cancel, nothing cleared partner_presence.active_order_id. It still
--      pointed at the cancelled order. pick_partner() only ever assigns work to
--      a partner whose active_order_id IS NULL — so this didn't just show a
--      phantom task, it took the picker OUT OF ROTATION. Amit could not be given
--      any new packing job until this cleared.
--
-- The cancel path already had triggers for the coupon and the wallet refund;
-- releasing the partner was simply missing.

begin;

-- 1. Never hand a partner a cancelled order. Recreated with one added guard
--    (status <> 'Cancelled'); everything else is unchanged. Fixing it here
--    reaches every already-installed partner app immediately, no update needed.
create or replace function public.get_my_task()
returns table(order_id uuid, code text, task_role text, state text, is_cod boolean, paid boolean, cod_amount numeric, location jsonb, items jsonb, is_return boolean, earning numeric, packed boolean)
language plpgsql security definer set search_path to 'public'
as $function$
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
    0::numeric,
    (o.status in ('Packed', 'Out for delivery', 'Delivered')
     or coalesce(o.is_return, false)
     or (o.subscription_id is not null and not coalesce(o.is_subscription, false)))
  from public.orders o
  where ((o.picker_id = v_uid and o.picker_state <> 'packed')
     or (o.rider_id = v_uid and o.delivery_state not in ('delivered','returned')))
     -- A cancelled order is nobody's task. (Delivered/returned are already
     -- excluded by the state checks above; Cancelled was the gap.)
     and o.status <> 'Cancelled'
     and coalesce(o.is_topup,false) = false and coalesce(o.is_membership,false) = false
     and not (o.subscription_id is not null and not coalesce(o.is_subscription,false))
  order by o.rider_assigned_at desc nulls last, o.picker_assigned_at desc nulls last
  limit 1;
end; $function$;

-- 2. When an order is cancelled, free whoever was working it: drop their
--    active_order_id so pick_partner can hand them the next job, and clear
--    needs_owner (a cancelled order is not the owner's to chase).
create or replace function public._release_partner_on_cancel()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if NEW.status = 'Cancelled' and OLD.status is distinct from NEW.status then
    update public.partner_presence
       set active_order_id = null
     where active_order_id = NEW.id;
    NEW.needs_owner := false;
  end if;
  return NEW;
end; $$;

-- BEFORE UPDATE so setting NEW.needs_owner takes effect on the same row write.
drop trigger if exists trg_release_partner_on_cancel on public.orders;
create trigger trg_release_partner_on_cancel
  before update of status on public.orders
  for each row execute function public._release_partner_on_cancel();

-- 3. Heal the state this bug already left behind: any partner still pinned to a
--    cancelled order, and any cancelled order still flagged for the owner.
update public.partner_presence pp
   set active_order_id = null
  from public.orders o
 where pp.active_order_id = o.id and o.status = 'Cancelled';

update public.orders
   set needs_owner = false
 where status = 'Cancelled' and needs_owner;

commit;
