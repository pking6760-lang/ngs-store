-- Device-level referral-farming guard.
--
-- On top of the ₹199 wallet gate, this stops one physical device from claiming
-- the referral welcome bonus more than once — even across new email accounts,
-- a VPN, incognito mode, or an app reinstall. The client sends a DETERMINISTIC
-- device fingerprint (computed from hardware/browser, not a stored random id),
-- so those evasions map back to the same hash. The IP is recorded as a soft
-- signal for admin review only (never a hard block — shared connections would
-- create false positives).

create table if not exists public.referral_device_claims (
  id          bigint generated always as identity primary key,
  device_hash text not null,
  referee_id  uuid references auth.users(id) on delete cascade,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rdc_device on public.referral_device_claims (device_hash);
create index if not exists idx_rdc_ip     on public.referral_device_claims (ip);

alter table public.referral_device_claims enable row level security;
-- Only admins can read it directly; the claim is written by the SECURITY DEFINER
-- apply_referral function. No anon/customer access.
drop policy if exists rdc_admin_read on public.referral_device_claims;
create policy rdc_admin_read on public.referral_device_claims
  for select using (public.is_admin());
revoke all on public.referral_device_claims from anon, authenticated;
grant select on public.referral_device_claims to authenticated;  -- gated by the admin RLS policy above

-- apply_referral now takes an optional device fingerprint and hard-blocks a
-- device that already claimed a referral. The old single-arg version is dropped
-- so the new one (with a defaulted p_device) is the only overload — old app
-- builds that send just {p_code} still resolve to it, so rollout is graceful.
drop function if exists public.apply_referral(text);
create or replace function public.apply_referral(p_code text, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_ref uuid; v_orders int; v_amt numeric;
        v_hdrs json; v_ip text; v_ua text; v_dev text := nullif(trim(coalesce(p_device,'')), '');
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  select coalesce(order_count, 0) into v_orders from public.profiles where id = v_uid;
  if v_orders > 0 then raise exception 'A referral only works before your first order.'; end if;
  if exists (select 1 from public.referrals where referee_id = v_uid) then
    raise exception 'You have already used a referral.';
  end if;

  -- Request signals (best-effort; missing on some paths).
  begin v_hdrs := current_setting('request.headers', true)::json; exception when others then v_hdrs := null; end;
  v_ip := split_part(coalesce(v_hdrs->>'x-forwarded-for', v_hdrs->>'cf-connecting-ip', ''), ',', 1);
  v_ua := v_hdrs->>'user-agent';

  -- Hard block: this physical device has already taken a referral bonus.
  if v_dev is not null and length(v_dev) >= 8
     and exists (select 1 from public.referral_device_claims where device_hash = v_dev) then
    raise exception 'This device has already used a referral offer.';
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

  -- Record the device/IP so the same device can't claim again, and so an admin
  -- can spot clusters of claims from one device or connection.
  insert into public.referral_device_claims (device_hash, referee_id, ip, user_agent)
    values (coalesce(v_dev, 'unknown-' || v_uid::text), v_uid, nullif(v_ip,''), v_ua);

  return jsonb_build_object('ok', true, 'reward', v_amt);
end; $function$;

revoke all on function public.apply_referral(text, text) from public, anon;
grant execute on function public.apply_referral(text, text) to authenticated;
