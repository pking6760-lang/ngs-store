-- Safe rollout for the delivery-OTP check. The strict version would block riders
-- still on the OLD partner app (which sends no code) from completing deliveries.
-- Add a `delivery_otp_strict` flag (default false = lenient): while lenient we
-- only reject a WRONG code that was actually entered, and allow an empty code
-- (old app) — so nothing breaks during the app rollout. Once every rider is on
-- the new app that always sends the code, the owner flips the flag to true and it
-- becomes mandatory.
alter table public.settings add column if not exists delivery_otp_strict boolean not null default false;

create or replace function public.partner_mark_delivered(p_order uuid, p_tendered numeric default null, p_code text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_rid uuid; v_state text; v_ret boolean; v_milk boolean; v_code text; v_strict boolean;
begin
  select rider_id, delivery_state, coalesce(is_return, false),
         (subscription_id is not null and not coalesce(is_subscription, false))
    into v_rid, v_state, v_ret, v_milk
    from public.orders where id = p_order;
  if not (public.is_admin() or (v_rid is not null and v_rid = auth.uid())) then
    raise exception 'Not your delivery.';
  end if;
  if not public.is_admin() and not v_ret and not v_milk
     and v_state <> 'out_for_delivery' then
    raise exception 'Slide "Out for delivery" first — collect the payment at the customer''s door.';
  end if;

  -- Proof of delivery. Admin overrides; returns and code-less (older) orders are exempt.
  if not public.is_admin() and not v_ret then
    select code into v_code from public.order_delivery_codes where order_id = p_order;
    if v_code is not null and coalesce(p_code, '') <> v_code then
      select coalesce(delivery_otp_strict, false) into v_strict from public.settings where id = 1;
      -- Strict: any wrong/missing code blocks. Lenient (default, during rollout):
      -- block only a code that was entered but wrong; allow an empty code so a
      -- rider on the old app can still deliver.
      if coalesce(v_strict, false) or coalesce(p_code, '') <> '' then
        raise exception 'Wrong delivery code. Ask the customer for the 4-digit code on their order screen.';
      end if;
    end if;
  end if;

  perform public._complete_delivery(p_order, p_tendered);
end; $$;
revoke all on function public.partner_mark_delivered(uuid, numeric, text) from public, anon;
grant execute on function public.partner_mark_delivered(uuid, numeric, text) to authenticated;
