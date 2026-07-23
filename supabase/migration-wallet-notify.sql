-- Tell the customer whenever their wallet changes — money credited (topup,
-- referral, reward, change, refund) or deducted (spent on an order). Inserting a
-- row into public.notifications also fires a push (via trg_notify_customer →
-- notify-customer), so the customer gets an in-app message AND a push.
create or replace function public.trg_wallet_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bal numeric; v_amt numeric; v_abs text; v_title text; v_body text; v_note text;
begin
  v_amt := coalesce(new.amount, 0);
  if v_amt = 0 then return new; end if;                       -- nothing moved
  select coalesce(sum(amount), 0) into v_bal
    from public.customer_wallet where user_id = new.user_id;
  v_abs  := trim(to_char(abs(v_amt), 'FM999999990.##'));
  v_note := nullif(trim(coalesce(new.note, '')), '');
  v_title := case
    when v_amt < 0            then '₹' || v_abs || ' paid from your wallet'
    when new.kind = 'referral' then '🎉 ₹' || v_abs || ' referral reward added'
    when new.kind = 'change'   then '💰 ₹' || v_abs || ' change added to your wallet'
    when new.kind = 'reward'   then '🎁 ₹' || v_abs || ' reward added to your wallet'
    when new.kind = 'refund'   then '↩️ ₹' || v_abs || ' refunded to your wallet'
    else '💰 ₹' || v_abs || ' added to your wallet'
  end;
  v_body := coalesce(v_note || ' · ', '') || 'Wallet balance ₹' || trim(to_char(v_bal, 'FM999999990.##'));
  insert into public.notifications (user_id, title, body) values (new.user_id, v_title, v_body);
  return new;
exception when others then return new;                        -- never block the wallet write
end; $$;

drop trigger if exists trg_wallet_notify on public.customer_wallet;
create trigger trg_wallet_notify
  after insert on public.customer_wallet
  for each row execute function public.trg_wallet_notify();
