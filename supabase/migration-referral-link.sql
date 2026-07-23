-- ════════════════════════════════════════════════════════════════════════════
-- Link-based, fully-automated referrals.
--
-- Flow: a customer shares their invite link (…/?ref=THEIR_CODE) via WhatsApp/
-- Instagram/copy. A brand-new customer opens it and logs in — the referral is
-- applied automatically (no code to type):
--   • The NEW customer gets a flat ₹30 in their NGS Wallet INSTANTLY on signup,
--     to spend on their first order.
--   • The REFERRER gets a flat ₹30 once that new customer's FIRST order is
--     actually DELIVERED (so the referrer reward can't be farmed by fake
--     signups — it only pays on a completed order).
--
-- Reward amount comes from settings.rewards.referral.amount (default ₹30).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Apply the referral from the shared link + credit the new customer instantly.
create or replace function public.apply_referral(p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_ref uuid; v_orders int; v_amt numeric;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  select coalesce(order_count, 0) into v_orders from public.profiles where id = v_uid;
  if v_orders > 0 then raise exception 'A referral only works before your first order.'; end if;
  if exists (select 1 from public.referrals where referee_id = v_uid) then
    raise exception 'You have already used a referral.';
  end if;
  select id into v_ref from public.profiles
    where upper(customer_code) = upper(trim(p_code)) and role = 'customer';
  if v_ref is null then raise exception 'That referral link is not valid.'; end if;
  if v_ref = v_uid then raise exception 'You can''t refer yourself.'; end if;
  select coalesce((rewards->'referral'->>'amount')::numeric, 30) into v_amt
    from public.settings where id = 1;
  if v_amt <= 0 then raise exception 'Referrals are not active right now.'; end if;

  -- 'linked' = new customer paid; the referrer is paid on the first delivery.
  insert into public.referrals (referrer_id, referee_id, code, reward_amount, status)
    values (v_ref, v_uid, upper(trim(p_code)), v_amt, 'linked');

  -- Instant welcome bonus into the new customer's wallet.
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (v_uid, v_amt, 'referral', 'Referral bonus — welcome to NGS!', v_uid);

  return jsonb_build_object('ok', true, 'reward', v_amt);
end; $function$;

-- 2) On the new customer's first successful DELIVERY, pay the REFERRER.
create or replace function public._reward_referral_on_delivery()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_rf public.referrals; v_amt numeric;
begin
  if NEW.status = 'Delivered' and NEW.status is distinct from OLD.status then
    -- Only real fulfilment orders count (not membership/top-up/plan masters).
    if coalesce(NEW.is_membership,false) or coalesce(NEW.is_topup,false)
       or coalesce(NEW.is_subscription,false) then
      return NEW;
    end if;
    select * into v_rf from public.referrals
      where referee_id = NEW.user_id and status = 'linked' for update;
    if v_rf.id is not null then
      v_amt := coalesce(v_rf.reward_amount, 30);
      if v_amt > 0 then
        insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
          values (v_rf.referrer_id, v_amt, 'referral', 'A friend joined with your link', NEW.id, NEW.user_id);
      end if;
      update public.referrals set status = 'rewarded', rewarded_at = now() where id = v_rf.id;
    end if;
  end if;
  return NEW;
end; $function$;

drop trigger if exists reward_referral_on_delivery on public.orders;
create trigger reward_referral_on_delivery
  after update of status on public.orders
  for each row execute function public._reward_referral_on_delivery();

select 'referral-link v2 ready' as status;
