-- Narrow the delivery-OTP to regular prepaid SINGLE orders only. Subscription /
-- milk-round deliveries are auto-dropped early morning when the customer isn't
-- present to share a code, so they must be exempt (like COD and returns).
begin;

-- Trigger: also skip subscription-linked orders (daily milk days have a
-- subscription_id but is_subscription=false).
create or replace function public._gen_delivery_code()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(new.is_membership, false) or coalesce(new.is_topup, false)
     or coalesce(new.is_return, false) or coalesce(new.is_subscription, false)
     or new.subscription_id is not null
     or lower(coalesce(new.payment_method, '')) in ('cod', 'cash') then
    return new;
  end if;
  insert into public.order_delivery_codes (order_id, code)
    values (new.id, lpad(floor(random() * 10000)::int::text, 4, '0'))
    on conflict (order_id) do nothing;
  return new;
end; $$;

-- Remove codes already generated for subscription/milk orders.
delete from public.order_delivery_codes odc
  using public.orders o
  where odc.order_id = o.id and o.subscription_id is not null;

-- partner_mark_delivered: exempt subscription/milk (v_milk) from the code check too.
create or replace function public.partner_mark_delivered(p_order uuid, p_tendered numeric default null, p_code text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_rid uuid; v_state text; v_ret boolean; v_milk boolean; v_cod boolean; v_code text; v_strict boolean;
begin
  select rider_id, delivery_state, coalesce(is_return, false),
         (subscription_id is not null and not coalesce(is_subscription, false)),
         lower(coalesce(payment_method, '')) in ('cod', 'cash')
    into v_rid, v_state, v_ret, v_milk, v_cod
    from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  if not public.is_admin() and not v_ret and not v_milk
     and v_state <> 'out_for_delivery' then
    raise exception 'Slide "Out for delivery" first — collect the payment at the customer''s door.';
  end if;

  -- Proof of delivery — regular PREPAID single orders only. COD (cash proof),
  -- subscription/milk (auto-dropped), returns and admin are exempt.
  if not public.is_admin() and not v_ret and not v_cod and not v_milk then
    select code into v_code from public.order_delivery_codes where order_id = p_order;
    if v_code is not null and coalesce(p_code, '') <> v_code then
      select coalesce(delivery_otp_strict, false) into v_strict from public.settings where id = 1;
      if coalesce(v_strict, false) or coalesce(p_code, '') <> '' then
        raise exception 'Wrong delivery code. Ask the customer for the 4-digit code on their order screen.';
      end if;
    end if;
  end if;

  perform public._complete_delivery(p_order, p_tendered);
end; $$;
revoke all on function public.partner_mark_delivered(uuid, numeric, text) from public, anon;
grant execute on function public.partner_mark_delivered(uuid, numeric, text) to authenticated;

commit;
