-- ═══════ 24-HOUR RETURN WINDOW ═══════
-- Returns are only allowed within 24 hours of delivery.

-- Make sure delivered_at is stamped on the owner/manual delivery path too, so
-- the window is measured from a real delivery time (not order placement).
create or replace function public.advance_order_status(p_order uuid, p_status text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_order public.orders;
  v_flow  text[] := array['Placed', 'Packed', 'Out for delivery', 'Delivered'];
  v_cur   int;
  v_new   int;
begin
  if not public.is_staff() then
    raise exception 'Only staff can update deliveries.';
  end if;
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'Order not found.'; end if;

  v_new := array_position(v_flow, p_status);
  if v_new is null then raise exception 'Invalid status.'; end if;
  v_cur := array_position(v_flow, v_order.status);
  if v_cur is not null and v_new < v_cur then
    raise exception 'Status can only move forward.';
  end if;

  update public.orders set
    status = p_status,
    delivered_at = case
      when p_status = 'Delivered' and delivered_at is null then now()
      else delivered_at end,
    payment_status = case
      when p_status = 'Delivered' and payment_status <> 'paid' then 'paid'
      else payment_status end
  where id = p_order;
end;
$function$;

-- Enforce the 24h window when creating a return.
drop function if exists public.admin_create_return(uuid, jsonb);
create or replace function public.admin_create_return(p_order uuid, p_items jsonb default null)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  o public.orders; v_new uuid; v_code text; v_seq int;
  v_line jsonb; v_pid text; v_qty int; v_ordered int; v_returned int; v_avail int;
  v_price numeric; v_amount numeric := 0; v_items jsonb; v_delivered timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.is_return then raise exception 'This is already a return.'; end if;
  if o.status not in ('Delivered','Returned') then raise exception 'Only delivered orders can be returned.'; end if;

  v_delivered := coalesce(o.delivered_at, o.created_at);
  if v_delivered < now() - interval '24 hours' then
    raise exception 'The 24-hour return window has passed — this order can no longer be returned.';
  end if;

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
