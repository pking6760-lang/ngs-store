-- ═══════════ PARTIAL RETURNS ═══════════
-- Admin can return specific items / quantities (e.g. 2 of 4 spoiled). Refund is
-- the value of the returned goods; earned points reverse in proportion. A return
-- that brings every item's returned qty up to the ordered qty is a FULL return —
-- then fees + wallet are refunded too, redeemed points come back, and the parent
-- is marked 'Returned'.

drop function if exists public.admin_create_return(uuid);
create or replace function public.admin_create_return(p_order uuid, p_items jsonb default null)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  o public.orders; v_new uuid; v_code text; v_seq int;
  v_line jsonb; v_pid text; v_qty int; v_ordered int; v_returned int; v_avail int;
  v_price numeric; v_amount numeric := 0; v_items jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.is_return then raise exception 'This is already a return.'; end if;
  if o.status not in ('Delivered','Returned') then raise exception 'Only delivered orders can be returned.'; end if;

  -- Default: return everything still returnable.
  v_items := p_items;
  if v_items is null or jsonb_array_length(v_items) = 0 then
    v_items := (select jsonb_agg(jsonb_build_object('id', product_id, 'qty', qty))
                from public.order_items where order_id = p_order);
  end if;

  v_seq := coalesce((select count(*) from public.orders where return_of = p_order and status <> 'Cancelled'), 0) + 1;
  v_code := o.human_code || '-R' || case when v_seq > 1 then v_seq::text else '' end;

  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status, accepted, member,
    item_total, total, payment_method, payment_status, address, distance_km, location,
    is_return, return_of
  ) values (
    v_code, o.user_id, o.customer_name, o.user_phone, 'Return requested', null, o.member,
    0, 0, 'return', 'paid', o.address, o.distance_km, o.location,
    true, p_order
  ) returning id into v_new;

  for v_line in select * from jsonb_array_elements(v_items) loop
    v_pid := v_line->>'id';
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select qty, price into v_ordered, v_price from public.order_items where order_id = p_order and product_id = v_pid;
    if v_ordered is null then continue; end if;
    -- qty already returned for this item across prior (non-cancelled) returns
    select coalesce(sum(oi.qty),0) into v_returned
      from public.order_items oi
      join public.orders r on r.id = oi.order_id
      where r.return_of = p_order and r.is_return and r.status <> 'Cancelled' and r.id <> v_new and oi.product_id = v_pid;
    v_avail := v_ordered - v_returned;
    if v_qty > v_avail then v_qty := v_avail; end if;
    if v_qty <= 0 then continue; end if;
    insert into public.order_items (order_id, product_id, name, icon, qty, price)
      select v_new, oi.product_id, oi.name, oi.icon, v_qty, oi.price
        from public.order_items oi where oi.order_id = p_order and oi.product_id = v_pid limit 1;
    v_amount := v_amount + v_price * v_qty;
  end loop;

  if v_amount <= 0 then
    delete from public.orders where id = v_new;
    raise exception 'Nothing left to return for the selected items.';
  end if;

  update public.orders set item_total = v_amount, total = v_amount where id = v_new;
  return v_new;
end $function$;
grant execute on function public.admin_create_return(uuid, jsonb) to authenticated;

create or replace function public.process_return_refund(p_return uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  r public.orders; o public.orders;
  v_goods numeric; v_fully boolean; v_refund numeric; v_target numeric;
  v_already numeric; v_reverse int; v_rev_done int;
begin
  select * into r from public.orders where id = p_return and is_return;
  if r.id is null then return; end if;
  select * into o from public.orders where id = r.return_of;
  if o.id is null then return; end if;

  v_goods   := coalesce(r.total, 0);       -- value of the goods in THIS return
  v_already := coalesce(o.refunded_amount, 0);

  -- Fully returned? every parent item's confirmed-returned qty >= ordered qty.
  select not exists (
    select 1 from public.order_items poi
    where poi.order_id = o.id
      and poi.qty > coalesce((
        select sum(roi.qty) from public.order_items roi
        join public.orders rr on rr.id = roi.order_id
        where rr.return_of = o.id and rr.is_return and rr.status = 'Returned'
          and roi.product_id = poi.product_id
      ), 0)
  ) into v_fully;

  if v_fully then
    -- Give back everything the customer paid (total + any wallet used), net of
    -- what earlier partial returns already refunded.
    v_target := coalesce(o.total,0) + coalesce(o.wallet_used,0);
    v_refund := greatest(v_target - v_already, 0);
    -- redeemed points returned once
    if coalesce(o.points_redeemed,0) > 0 and not coalesce(o.points_restored,false)
       and exists (select 1 from public.points_ledger where order_id = o.id and reason like 'Redeemed on%') then
      update public.profiles set points = points + o.points_redeemed where id = o.user_id;
      insert into public.points_ledger(user_id,order_id,delta,reason)
        values (o.user_id, o.id, o.points_redeemed, 'Redeemed points returned (returned)');
    end if;
    -- reverse whatever earned points haven't been reversed yet
    select coalesce(-sum(delta),0) into v_rev_done from public.points_ledger
      where order_id = o.id and reason like 'Earned points reversed%';
    v_reverse := greatest(coalesce(o.points_earned,0) - v_rev_done, 0);
    if v_reverse > 0 and exists (select 1 from public.points_ledger where order_id=o.id and delta>0 and reason like 'Earned%') then
      update public.profiles set points = greatest(0, points - v_reverse) where id = o.user_id;
      insert into public.points_ledger(user_id,order_id,delta,reason)
        values (o.user_id, o.id, -v_reverse, 'Earned points reversed (returned)');
    end if;
    update public.orders set status='Returned', points_restored=true,
      refunded_amount = v_already + v_refund, refunded_at = now() where id = o.id;
  else
    -- Partial: refund the goods value; reverse earned points in proportion.
    v_refund := v_goods;
    if coalesce(o.points_earned,0) > 0 and coalesce(o.item_total,0) > 0
       and exists (select 1 from public.points_ledger where order_id=o.id and delta>0 and reason like 'Earned%') then
      select coalesce(-sum(delta),0) into v_rev_done from public.points_ledger
        where order_id = o.id and reason like 'Earned points reversed%';
      v_reverse := floor(o.points_earned * v_goods / o.item_total);
      v_reverse := least(v_reverse, greatest(coalesce(o.points_earned,0) - v_rev_done, 0));
      if v_reverse > 0 then
        update public.profiles set points = greatest(0, points - v_reverse) where id = o.user_id;
        insert into public.points_ledger(user_id,order_id,delta,reason)
          values (o.user_id, o.id, -v_reverse, 'Earned points reversed (partial return)');
      end if;
    end if;
    update public.orders set refunded_amount = v_already + v_refund, refunded_at = now() where id = o.id;
  end if;

  if v_refund > 0 then
    insert into public.customer_wallet(user_id, amount, kind, note, order_id, created_by)
      values (o.user_id, v_refund, 'refund', 'Return refund for ' || o.human_code, o.id, o.user_id);
  end if;
end $function$;

-- Driver confirms the pickup → pay the pickup fee, close the task, run the refund.
create or replace function public.partner_mark_returned(p_order uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare cfg public.ops_config; v_rid uuid; v_parent uuid; v_earn numeric;
begin
  select * into cfg from public.ops_config where id = 1;
  select rider_id, return_of into v_rid, v_parent from public.orders where id = p_order and is_return;
  if v_parent is null then raise exception 'Not a return order.'; end if;
  if not (public.is_admin() or v_rid = auth.uid()) then raise exception 'Not your pickup.'; end if;
  v_earn := round(coalesce(cfg.rider_floor, 0), 2);
  update public.orders
     set delivery_state = 'returned', delivered_at = now(), status = 'Returned',
         rider_earning = case when v_rid is not null then v_earn else 0 end
   where id = p_order;
  if v_rid is not null then
    insert into public.wallet_ledger (partner_id, order_id, kind, amount, note, created_by)
      values (v_rid, p_order, 'earning', v_earn, 'Return pickup', auth.uid());
    update public.partner_presence set active_order_id = null where user_id = v_rid and active_order_id = p_order;
  end if;
  perform public.process_return_refund(p_order);
end $function$;
grant execute on function public.partner_mark_returned(uuid) to authenticated;
