-- Per-friend referral history for the customer "Refer & earn" screen.
-- Returns one row per person who joined with the caller's code, newest first.
-- We expose only the friend's FIRST name (never phone/email) so the referrer
-- can recognise who it was without leaking anyone's contact details.
--
-- Status meaning (matches apply_referral + the first-delivery reward hook):
--   'linked'   → friend signed up with your link; your reward is pending until
--                their first delivery completes.
--   'rewarded' → friend completed their first order; reward credited to you.
create or replace function public.my_referral_history(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_rows jsonb;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
  from (
    select
      -- First name only; fall back to a friendly label when the profile has no name.
      coalesce(nullif(split_part(trim(p.name), ' ', 1), ''), 'A friend') as name,
      r.status,
      r.reward_amount as amount,
      r.created_at    as joined_at,
      r.rewarded_at   as rewarded_at
    from public.referrals r
    left join public.profiles p on p.id = r.referee_id
    where r.referrer_id = v_uid
    order by r.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) t;

  return v_rows;
end; $$;

grant execute on function public.my_referral_history(int) to authenticated;
