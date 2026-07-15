-- ════════════════════════════════════════════════════════════════════════════
-- Referral loop — "Refer a friend, both earn."
--
-- The referral CODE is the customer_code (NGS####) every customer already has.
-- A brand-new customer applies a friend's code BEFORE their first order. When
-- that new customer completes their first order, both sides get a wallet reward
-- — the referrer's payout is capped by the order's profit so the shop never
-- pays out more than it earned. Reward is store credit (usable on the next
-- order), earned only after a real purchase — not a free upfront fund.
--
-- Amount lives in settings.rewards.referral.amount (default ₹30). Set 0 to
-- switch the whole programme off.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.referrals (
  id            bigint generated always as identity primary key,
  referrer_id   uuid not null references public.profiles(id),
  referee_id    uuid not null references public.profiles(id) unique,   -- one referral per new user
  code          text not null,
  status        text not null default 'pending',                      -- 'pending' | 'rewarded'
  reward_amount numeric not null default 0,
  created_at    timestamptz not null default now(),
  rewarded_at   timestamptz
);
alter table public.referrals enable row level security;

drop policy if exists "referrals read own" on public.referrals;
create policy "referrals read own" on public.referrals
  for select using (referrer_id = auth.uid() or referee_id = auth.uid() or public.is_admin());
-- All writes happen through the SECURITY DEFINER functions below (no direct
-- insert/update policy → clients can't forge referrals).

-- Default the reward amount if it isn't set yet.
update public.settings
  set rewards = jsonb_set(rewards, '{referral}',
      coalesce(rewards->'referral', '{"amount":30}'::jsonb))
  where id = 1;

-- ── apply_referral(code): a new customer enters a friend's code ──────────────
create or replace function public.apply_referral(p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_ref uuid; v_orders int; v_amt numeric;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  select coalesce(order_count, 0) into v_orders from public.profiles where id = v_uid;
  if v_orders > 0 then raise exception 'A referral code only works before your first order.'; end if;
  if exists (select 1 from public.referrals where referee_id = v_uid) then
    raise exception 'You have already used a referral code.';
  end if;
  select id into v_ref from public.profiles
    where upper(customer_code) = upper(trim(p_code)) and role = 'customer';
  if v_ref is null then raise exception 'That referral code is not valid.'; end if;
  if v_ref = v_uid then raise exception 'You can''t use your own code.'; end if;
  select coalesce((rewards->'referral'->>'amount')::numeric, 30) into v_amt
    from public.settings where id = 1;
  if v_amt <= 0 then raise exception 'Referrals are not active right now.'; end if;
  insert into public.referrals (referrer_id, referee_id, code, reward_amount)
    values (v_ref, v_uid, upper(trim(p_code)), v_amt);
  return jsonb_build_object('ok', true, 'reward', v_amt);
end; $function$;
grant execute on function public.apply_referral(text) to authenticated;
revoke execute on function public.apply_referral(text) from public, anon;

-- ── my_referral_stats(): code to share + how many friends joined / earned ────
create or replace function public.my_referral_stats()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_code text; v_joined int; v_earned numeric; v_amt numeric; v_used boolean;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  select customer_code into v_code from public.profiles where id = v_uid;
  select count(*), coalesce(sum(reward_amount) filter (where status = 'rewarded'), 0)
    into v_joined, v_earned from public.referrals where referrer_id = v_uid;
  select coalesce((rewards->'referral'->>'amount')::numeric, 30) into v_amt from public.settings where id = 1;
  select exists(select 1 from public.referrals where referee_id = v_uid) into v_used;
  return jsonb_build_object('code', v_code, 'joined', v_joined, 'earned', v_earned,
                            'amount', v_amt, 'usedCode', v_used);
end; $function$;
grant execute on function public.my_referral_stats() to authenticated;
revoke execute on function public.my_referral_stats() from public, anon;
