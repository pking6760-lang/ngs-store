-- AUDIT FIX (Medium #6): admin_refund_to_wallet must not refund money that was
-- never collected. Previously it only capped the refund at the order total — so a
-- COD order that was cancelled/never delivered (no cash taken) or an unpaid online
-- order could still be "refunded", minting wallet credit for money never received.
-- Now: online must be paid; COD must have been delivered (cash in hand).
create or replace function public.admin_refund_to_wallet(p_order uuid, p_amount numeric, p_note text default null)
returns numeric
language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_total numeric; v_already numeric; v_pm text; v_ps text; v_status text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a refund amount greater than 0.'; end if;
  select user_id, total, coalesce(refunded_amount, 0), lower(coalesce(payment_method,'')), coalesce(payment_status,''), status
    into v_uid, v_total, v_already, v_pm, v_ps, v_status
    from public.orders where id = p_order;
  if v_uid is null then raise exception 'Order not found.'; end if;
  if v_already + p_amount > v_total then raise exception 'Refund would exceed the order total.'; end if;

  -- Only refund money that was actually collected.
  if v_pm in ('cod', 'cash') then
    if v_status <> 'Delivered' then
      raise exception 'This COD order was not delivered, so no cash was collected — nothing to refund.';
    end if;
  else
    if v_ps <> 'paid' then
      raise exception 'This order is not paid, so there is nothing to refund.';
    end if;
  end if;

  insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
    values (v_uid, p_amount, 'refund', coalesce(nullif(trim(p_note), ''), 'Refund'), p_order, auth.uid());
  update public.orders set refunded_amount = v_already + p_amount, refunded_at = now() where id = p_order;
  insert into public.notifications (user_id, title, body)
    values (v_uid, 'Refund added to your NGS Wallet',
            '₹' || trim(to_char(p_amount, 'FM999999990.00')) || ' has been added to your NGS Wallet. Use it on your next order.');
  return p_amount;
end $$;
