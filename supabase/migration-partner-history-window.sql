-- The partner app shows three months, not a career.
--
-- Same shape as the customer change, and the same trap avoided: the app was
-- adding up EVERY ledger row on the phone to work out the balance and the cash
-- in hand. Cutting the list to three months would have quietly made both wrong
-- -- and cash-in-hand is money the rider is physically carrying, checked against
-- what they hand over. That is not a number to get wrong to save a few bytes.
--
-- So the totals move to the server, over the whole ledger, and only the LIST is
-- windowed. Same answer, fewer rows on the wire.

begin;

create or replace function public.get_my_ledger(p_months int default 3)
returns table (id uuid, kind text, amount numeric, cash_delta numeric, note text,
               order_id uuid, code text, at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select w.id, w.kind, w.amount, w.cash_delta, w.note, w.order_id, o.human_code, w.created_at
    from public.wallet_ledger w
    left join public.orders o on o.id = w.order_id
   where w.partner_id = auth.uid()
     and w.created_at >= now() - make_interval(months => greatest(coalesce(p_months, 3), 1))
   order by w.created_at desc
$$;

-- Balance, cash in hand and lifetime earnings — over EVERY row, always.
create or replace function public.get_my_wallet_totals()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'balance',      coalesce(sum(amount), 0),
    'cashInHand',   coalesce(sum(cash_delta), 0),
    'lifetimeEarned',  coalesce(sum(amount) filter (where kind = 'earning'), 0),
    'lifetimePenalty', coalesce(sum(abs(amount)) filter (where kind = 'penalty'), 0),
    'entries',      count(*))
    from public.wallet_ledger where partner_id = auth.uid()
$$;

revoke all on function public.get_my_ledger(int) from public, anon;
revoke all on function public.get_my_wallet_totals() from public, anon;
grant execute on function public.get_my_ledger(int) to authenticated;
grant execute on function public.get_my_wallet_totals() to authenticated;

commit;
