-- Monday payout run: a push to the owner every Monday listing exactly who to
-- pay and how much, plus the admin-side list that backs it.
--
-- Background: pay is already accrued per job into wallet_ledger, and the owner
-- clears it in Admin → Partners → "Record payout". What was missing is the
-- prompt — nothing told the owner it was payday, and nothing added the amounts
-- up across the team. That's this.
--
-- THE ONE NUMBER THAT MATTERS — "payable":
--   payable = sum(amount) EXCLUDING the two COD cash kinds.
-- i.e. earnings + adjustments − penalties − payouts already made.
--
-- The COD kinds must be excluded. cod_collected books amount −₹800 (the rider
-- is holding the shop's ₹800) and cod_deposited books +₹800 when it comes back.
-- They net to zero once deposited, but a rider still carrying cash shows a
-- balance ₹800 BELOW what we actually owe them. Paying the raw balance would
-- silently underpay them by the cash they're holding — two unrelated debts
-- cancelling each other out. Cash-in-hand is tracked separately (cash_delta)
-- and settled by "Confirm cash deposit", never by docking pay.
--
-- A negative payable (penalties above earnings) is reported but never paid —
-- it carries forward and is worked off by the next jobs.

begin;

-- ── Who to pay, and how much ──────────────────────────────────────────────
-- Admin-only. One row per approved partner, whatever their role, so pickers
-- and drivers are both covered by the same weekly run.
create or replace function public.admin_payout_due()
returns table(user_id uuid, emp_code text, name text, role text,
              payable numeric, cash_in_hand numeric,
              week_earnings numeric, week_penalty numeric, week_jobs int,
              last_payout_at timestamptz, last_payout_amount numeric)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_week_start timestamptz;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  -- Last 7 days in IST — context for the owner, not the amount owed.
  v_week_start := (((now() at time zone 'Asia/Kolkata')::date - 6) || ' 00:00')::timestamp
                    at time zone 'Asia/Kolkata';
  return query
  select p.user_id, p.emp_code, p.full_name, p.role,
    round(coalesce(sum(w.amount) filter (
      where w.kind not in ('cod_collected','cod_deposited')), 0), 2),
    round(coalesce(sum(w.cash_delta), 0), 2),
    round(coalesce(sum(w.amount) filter (
      where w.kind = 'earning' and w.created_at >= v_week_start), 0), 2),
    round(coalesce(sum(abs(w.amount)) filter (
      where w.kind = 'penalty' and w.created_at >= v_week_start), 0), 2),
    coalesce(count(*) filter (
      where w.kind = 'earning' and w.created_at >= v_week_start), 0)::int,
    max(w.created_at) filter (where w.kind = 'payout'),
    round(abs(coalesce((array_agg(w.amount order by w.created_at desc)
                          filter (where w.kind = 'payout'))[1], 0)), 2)
  from public.partners p
  left join public.wallet_ledger w on w.partner_id = p.user_id
  where p.status = 'approved'
  group by p.user_id, p.emp_code, p.full_name, p.role
  order by 5 desc, p.full_name;
end; $$;

revoke all on function public.admin_payout_due() from public, anon;
grant execute on function public.admin_payout_due() to authenticated;  -- is_admin() gates it

-- ── The Monday push ───────────────────────────────────────────────────────
-- Wording is built by a separate function that RETURNS the message instead of
-- sending it, so the exact push can be inspected any time without spamming the
-- owner's phone:  select public.payout_reminder_text(false);
-- Returns null when there is nothing to say (the silent Tuesday case).
create or replace function public.payout_reminder_text(p_followup boolean default false)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_total numeric := 0; v_people int := 0; v_names text := '';
  v_cash_names text := ''; v_cash_total numeric := 0; v_owing int := 0;
  v_body text; v_title text; v_shown int := 0; r record;
begin
  for r in
    select p.full_name, p.emp_code,
      round(coalesce(sum(w.amount) filter (
        where w.kind not in ('cod_collected','cod_deposited')), 0), 2) as payable,
      round(coalesce(sum(w.cash_delta), 0), 2) as cash
    from public.partners p
    left join public.wallet_ledger w on w.partner_id = p.user_id
    where p.status = 'approved'
    group by p.full_name, p.emp_code
    order by 3 desc, p.full_name
  loop
    if r.payable > 0 then
      v_total := v_total + r.payable;
      v_people := v_people + 1;
      -- Name the first 3; the rest roll into "+N more" so the push stays short.
      if v_shown < 3 then
        v_names := v_names || case when v_names = '' then '' else ', ' end
                   || r.full_name || ' ₹' || round(r.payable);
        v_shown := v_shown + 1;
      end if;
    elsif r.payable < 0 then
      v_owing := v_owing + 1;
    end if;
    if r.cash > 0 then
      v_cash_total := v_cash_total + r.cash;
      v_cash_names := v_cash_names || case when v_cash_names = '' then '' else ', ' end || r.full_name;
    end if;
  end loop;

  if v_people > 3 then
    v_names := v_names || ' +' || (v_people - 3) || ' more';
  end if;

  if v_total <= 0 then
    -- Nothing owed. Stay silent on the follow-up; on Monday still confirm, so
    -- "no message" never has to mean both "all paid" and "the job didn't run".
    if p_followup then return null; end if;
    return jsonb_build_object(
      'title', '💰 Payout day',
      'body', 'Nothing to pay this week — everyone settled.'
        || case when v_owing > 0
                then ' (' || v_owing || ' carrying a penalty balance.)' else '' end);
  end if;

  v_title := case when p_followup then '⏰ Payout still pending' else '💰 Payout day — pay the team' end;
  v_body := '₹' || round(v_total) || ' to ' || v_people || ' '
            || case when v_people = 1 then 'person' else 'people' end
            || ' · ' || v_names || '.';
  if v_cash_total > 0 then
    v_body := v_body || ' ⚠️ ' || v_cash_names || ' still holding ₹' || round(v_cash_total)
              || ' shop cash — take the deposit first.';
  end if;
  v_body := v_body || ' Admin → Partners → Record payout.';

  return jsonb_build_object('title', v_title, 'body', v_body);
end; $$;

create or replace function public.owner_payout_reminder(p_followup boolean default false)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_msg jsonb;
begin
  v_msg := public.payout_reminder_text(p_followup);
  if v_msg is null then return; end if;   -- nothing to say
  perform public.notify_owner(v_msg->>'title', v_msg->>'body', 'payout_due');
end; $$;

-- Neither is reachable from the apps. The whole team's pay in one string is
-- exactly what a partner shouldn't be able to read, and an app-callable
-- reminder would let anyone ring the owner's phone at will. Admins get the same
-- data through admin_payout_due(), which is gated on is_admin().
revoke all on function public.owner_payout_reminder(boolean) from public, anon, authenticated;
revoke all on function public.payout_reminder_text(boolean) from public, anon, authenticated;

-- ── Schedule ──────────────────────────────────────────────────────────────
-- pg_cron runs in UTC. 10:00 IST = 04:30 UTC, same calendar day (IST = UTC+5:30),
-- so day-of-week 1/2 really is Monday/Tuesday morning for the shop.
select cron.schedule('owner-payout-reminder', '30 4 * * 1', $$select public.owner_payout_reminder(false)$$);
select cron.schedule('owner-payout-followup', '30 4 * * 2', $$select public.owner_payout_reminder(true)$$);

commit;
