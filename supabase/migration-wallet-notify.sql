-- Tell the customer whenever their wallet changes — money credited (topup,
-- referral, reward, doorstep change, refund) or deducted (spent on an order).
-- Inserting a row into public.notifications also fires a push (via
-- trg_notify_customer → notify-customer), so the customer gets an in-app
-- message AND a push. Wording is deliberately clean and bank/UPI-style.
create or replace function public.trg_wallet_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bal numeric; v_amt numeric; v_amt_s text; v_bal_s text;
        v_title text; v_reason text; v_code text;
begin
  v_amt := coalesce(new.amount, 0);
  if v_amt = 0 then return new; end if;                          -- nothing moved

  select coalesce(sum(amount), 0) into v_bal
    from public.customer_wallet where user_id = new.user_id;
  if new.order_id is not null then
    select human_code into v_code from public.orders where id = new.order_id;
  end if;

  v_amt_s := trim(to_char(abs(v_amt), 'FM999,999,990.00'));      -- e.g. 1,234.00
  v_bal_s := trim(to_char(v_bal,      'FM999,999,990.00'));

  if v_amt < 0 then
    v_title  := '₹' || v_amt_s || ' debited from your NGS wallet';
    v_reason := 'Payment' || coalesce(' for order ' || v_code, '') || '.';
  else
    v_title  := '₹' || v_amt_s || ' credited to your NGS wallet';
    v_reason := case new.kind
      when 'change'   then 'Balance returned from your cash payment' || coalesce(' for order ' || v_code, '') || '.'
      when 'referral' then 'Referral reward credited to your wallet.'
      when 'reward'   then 'Reward credited' || coalesce(' for order ' || v_code, '') || '.'
      when 'refund'   then 'Refund processed' || coalesce(' for order ' || v_code, '') || '.'
      when 'topup'    then 'Money added to your wallet.'
      else 'Amount credited to your wallet.'
    end;
  end if;

  insert into public.notifications (user_id, title, body)
  values (new.user_id, v_title, v_reason || ' Available balance: ₹' || v_bal_s || '.');
  return new;
exception when others then return new;                           -- never block the wallet write
end; $$;

drop trigger if exists trg_wallet_notify on public.customer_wallet;
create trigger trg_wallet_notify
  after insert on public.customer_wallet
  for each row execute function public.trg_wallet_notify();
