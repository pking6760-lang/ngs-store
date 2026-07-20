-- ════════════════════════════════════════════════════════════════════════════
-- Skip a subscription day ("not home tomorrow — skip it, but I still want all my
-- milk"). A skipped day is NOT lost: the plan delivers on the next non-skipped
-- date instead, so the customer still gets every day they paid for.
--   • subscriptions.skip_dates: dates to skip.
--   • sub_generate_due: delivery #k lands on the k-th non-skipped date from start.
--   • skip_next_delivery(id): skip the soonest upcoming delivery — cancels its
--     already-created order (milk extends the plan; paid add-ons are refunded),
--     restores stock, and regenerates the replacement day.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.subscriptions add column if not exists skip_dates date[] not null default '{}';

-- Delivery #k (k = days_done+1) is the k-th date from start_date NOT in skip_dates.
create or replace function public.sub_generate_due(p_plan uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_today date := (now() at time zone 'Asia/Kolkata')::date; v_deliver date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_plan::text, 4242));
  for i in 1..60 loop
    select * into s from public.subscriptions where id = p_plan;
    if s.id is null or s.status <> 'active' then return; end if;
    if s.days_done >= s.days_total then
      update public.subscriptions set status = 'completed', updated_at = now() where id = p_plan;
      return;
    end if;
    -- k-th non-skipped delivery date (skip days push everything later).
    select d into v_deliver from (
      select s.start_date + g as d
      from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
    ) t
    where t.d <> all (coalesce(s.skip_dates, '{}'::date[]))
    order by t.d offset s.days_done limit 1;
    exit when v_deliver is null or v_today < v_deliver - 1;
    perform public._sub_create_order(s, v_deliver);
    update public.subscriptions
      set days_done = days_done + 1, last_delivery = v_deliver, updated_at = now()
      where id = p_plan;
  end loop;
  update public.subscriptions set status = 'completed', updated_at = now()
    where id = p_plan and days_done >= days_total and status = 'active';
end; $function$;
revoke execute on function public.sub_generate_due(uuid) from public, anon, authenticated;

-- Skip the plan's next upcoming delivery. Returns the skipped date.
create or replace function public.skip_next_delivery(p_id uuid)
 returns date language plpgsql security definer set search_path to 'public' as $function$
declare s public.subscriptions; v_next date; v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_milk int; r record;
begin
  select * into s from public.subscriptions where id = p_id and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Subscription not found.'; end if;
  if s.status <> 'active' then raise exception 'This plan is not active.'; end if;

  -- Next delivery: the soonest already-scheduled milk order, else the next date
  -- we would generate.
  select min(deliver_on) into v_next from public.orders
    where subscription_id = p_id and status = 'Scheduled' and payment_method = 'subscription';
  if v_next is null then
    select d into v_next from (
      select s.start_date + g as d
      from generate_series(0, s.days_total + coalesce(array_length(s.skip_dates, 1), 0) + 3) g
    ) t where t.d <> all (coalesce(s.skip_dates, '{}'::date[])) order by t.d offset s.days_done limit 1;
  end if;
  if v_next is null or v_next <= v_today then
    raise exception 'Too late to skip — that delivery is today or already on the way.';
  end if;

  -- Mark the date skipped.
  update public.subscriptions
    set skip_dates = array_append(coalesce(skip_dates, '{}'::date[]), v_next), updated_at = now()
    where id = p_id;

  -- Give back the stock reserved by every order on that date.
  update public.products pr set stock = pr.stock + agg.qty
    from (select oi.product_id, sum(oi.qty) qty
          from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.subscription_id = p_id and o.deliver_on = v_next and o.status = 'Scheduled'
          group by oi.product_id) agg
    where pr.id = agg.product_id and pr.stock is not null;

  -- Refund any prepaid ADD-ON orders on that date (they won't be delivered).
  for r in select id, total, human_code from public.orders
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled'
      and payment_method <> 'subscription' and payment_status = 'paid' loop
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (s.user_id, r.total, 'refund', 'Skipped delivery — ' || r.human_code, r.id, s.user_id);
  end loop;

  -- Cancel the milk daily order for that date → the plan makes it up later.
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled' and payment_method = 'subscription';
  get diagnostics v_milk = row_count;
  -- Cancel the add-on orders too.
  update public.orders set status = 'Cancelled'
    where subscription_id = p_id and deliver_on = v_next and status = 'Scheduled' and payment_method <> 'subscription';

  if v_milk > 0 then
    update public.subscriptions set days_done = greatest(days_done - v_milk, 0), updated_at = now() where id = p_id;
  end if;

  perform public.sub_generate_due(p_id);   -- create the replacement day if due
  return v_next;
end; $function$;
revoke execute on function public.skip_next_delivery(uuid) from public, anon;
grant execute on function public.skip_next_delivery(uuid) to authenticated;
