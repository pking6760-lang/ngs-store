-- Lifetime NGS Prime value for the Membership screen.
-- Aggregated server-side over ALL of the member's orders (the client only
-- fetches the last 100, which would undercount a heavy user), so the "lifetime
-- savings" and "orders with Prime" figures are exact and can't be gamed.
--
-- Savings breakdown (both are real money the member did NOT spend):
--   product_saved  = sum(member_savings)  — recorded at checkout: the gap
--                    between the member price and the regular unit price.
--   delivery_saved = the standard delivery fee a non-member WOULD have paid on
--                    member orders that got free delivery while below the
--                    free-delivery threshold. Orders that would have been free
--                    anyway (above the threshold) are excluded, so we never
--                    over-claim. Valued at the current fee (a close estimate;
--                    labelled as "saved on delivery", not an invoice).
create or replace function public.my_prime_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_fee numeric; v_free_above numeric;
  v_orders int; v_product numeric; v_delivery numeric;
  v_since timestamptz; v_until timestamptz; v_code text; v_member boolean;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;

  select coalesce(delivery_fee, 0), coalesce(free_delivery_above, 0)
    into v_fee, v_free_above from public.settings where id = 1;

  select is_member, member_since, member_until, customer_code
    into v_member, v_since, v_until, v_code
    from public.profiles where id = v_uid;

  -- Only completed value counts; exclude cancelled orders from the tally.
  select
    count(*),
    coalesce(sum(member_savings), 0),
    coalesce(sum(case
      when coalesce(delivery_fee, 0) = 0 and item_total < v_free_above then v_fee
      else 0 end), 0)
  into v_orders, v_product, v_delivery
  from public.orders
  where user_id = v_uid
    and member = true
    and coalesce(status, '') <> 'Cancelled';

  return jsonb_build_object(
    'memberOrders',    v_orders,
    'productSaved',    round(v_product),
    'deliverySaved',   round(v_delivery),
    'lifetimeSavings', round(v_product + v_delivery),
    'memberSince',     v_since,
    'memberUntil',     v_until,
    'code',            v_code,
    'isMember',        coalesce(v_member, false)
  );
end; $$;

grant execute on function public.my_prime_stats() to authenticated;
