-- Admin "Referral watch" screen: surface device/IP clusters and reverse a
-- fraudulent referral bonus.

-- List every referral claim, enriched with the referee/referrer, the referral
-- status, and how many OTHER claims share the same device or IP (the cluster
-- size). The client flags a row as suspicious when device_count > 1 or
-- ip_count > 1. Placeholder 'unknown-<uid>' device hashes (old builds that sent
-- no fingerprint) never count as a cluster.
create or replace function public.admin_referral_watch()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  with claims as (
    select c.id, c.referee_id, c.device_hash, c.ip, c.created_at,
           rp.customer_code as code, rp.name, rp.email,
           r.status, coalesce(r.reward_amount, 30) as reward_amount,
           rr.customer_code as referrer_code, rr.name as referrer_name
    from public.referral_device_claims c
    left join public.profiles  rp on rp.id = c.referee_id
    left join public.referrals r  on r.referee_id = c.referee_id
    left join public.profiles  rr on rr.id = r.referrer_id
  ),
  enriched as (
    select cl.*,
      (select count(*) from public.referral_device_claims d
         where d.device_hash = cl.device_hash and cl.device_hash not like 'unknown-%') as device_count,
      (select count(*) from public.referral_device_claims d2
         where d2.ip = cl.ip and coalesce(cl.ip,'') <> '') as ip_count,
      (select coalesce(sum(w.amount), 0) from public.customer_wallet w
         where w.user_id = cl.referee_id and w.kind in ('referral','adjustment')) as wallet_net
    from claims cl
  )
  select coalesce(
           jsonb_agg(to_jsonb(e) order by e.device_count desc, e.ip_count desc, e.created_at desc),
           '[]'::jsonb)
    into v_rows
    from enriched e;
  return v_rows;
end; $$;

-- Reverse a referral bonus: debit the referee's welcome credit, and if the
-- referrer was already paid (order delivered), debit that too. Idempotent —
-- refuses to reverse a referral that's already been clawed back.
create or replace function public.admin_referral_clawback(p_referee uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rf public.referrals; v_amt numeric; v_note text; v_referrer_reversed boolean := false;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into v_rf from public.referrals where referee_id = p_referee for update;
  if v_rf.id is null then raise exception 'No referral found for this customer.'; end if;
  if v_rf.status = 'clawed' then raise exception 'This referral has already been reversed.'; end if;
  v_amt := coalesce(v_rf.reward_amount, 30);
  v_note := 'Referral bonus reversed'
    || case when coalesce(trim(p_reason), '') <> '' then ' — ' || trim(p_reason) else ' (fraud review)' end;

  -- Take back the new customer's welcome bonus.
  insert into public.customer_wallet (user_id, amount, kind, note, created_by)
    values (v_rf.referee_id, -v_amt, 'adjustment', v_note, auth.uid());

  -- If the referrer was already rewarded (referee's first order delivered), take that back too.
  if v_rf.status = 'rewarded' then
    insert into public.customer_wallet (user_id, amount, kind, note, created_by)
      values (v_rf.referrer_id, -v_amt, 'adjustment', v_note || ' (referred account flagged)', auth.uid());
    v_referrer_reversed := true;
  end if;

  update public.referrals set status = 'clawed' where id = v_rf.id;
  return jsonb_build_object('ok', true, 'reversed', v_amt, 'referrer_reversed', v_referrer_reversed);
end; $$;

revoke all on function public.admin_referral_watch()               from public, anon;
revoke all on function public.admin_referral_clawback(uuid, text)  from public, anon;
grant execute on function public.admin_referral_watch()              to authenticated;
grant execute on function public.admin_referral_clawback(uuid, text) to authenticated;
