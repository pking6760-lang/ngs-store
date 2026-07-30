-- UPI Autopay — Phase 5: let the daily charge engine run for the owner's TEST
-- PHONE while the master flag is still off, so the real once-a-day bank debit can
-- be proven end-to-end before any customer can use it.
--
--   flag off + no test phone  → engine fully dormant (unchanged)
--   flag off + test phone set → engine charges ONLY that phone's subscriptions
--   flag on                   → engine charges everyone (launched)

begin;

-- Due list now honours the same gate: everyone when launched, else only the
-- test phone's plans.
create or replace function public.sub_upi_due_list(p_deliver date)
returns table(id uuid)
language sql security definer set search_path to 'public'
as $$
  with cfg as (
    select coalesce(upi_autopay_enabled, false) as launched,
           right(regexp_replace(coalesce(upi_autopay_test_phone, ''), '\D', '', 'g'), 10) as testph
    from public.settings where id = 1
  )
  select s.id
  from public.subscriptions s, cfg
  where s.status = 'active'
    and s.pay_method = 'upi_autopay'
    and coalesce(s.mandate_status, '') = 'confirmed'
    and s.mandate_token is not null
    and s.days_done < s.days_total
    and public.sub_upi_next_deliver(s) = p_deliver
    and not exists (
      select 1 from public.subscription_charges c
      where c.subscription_id = s.id and c.deliver_date = p_deliver
    )
    and (
      cfg.launched
      or (cfg.testph <> '' and exists (
            select 1 from public.profiles p
            where p.id = s.user_id
              and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = cfg.testph))
    );
$$;
revoke all on function public.sub_upi_due_list(date) from public, anon, authenticated;

-- Cron entries: fire the edge function when launched OR a test phone is set (the
-- due list above still limits WHO gets charged). Fully dormant otherwise.
create or replace function public.run_upi_autopay_charges()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_secret text; v_on boolean; v_test text;
begin
  select coalesce(upi_autopay_enabled, false), coalesce(nullif(btrim(upi_autopay_test_phone), ''), '')
    into v_on, v_test from public.settings where id = 1;
  if not v_on and v_test = '' then return; end if;

  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/sub-charge-upi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then null;
end; $$;

create or replace function public.run_upi_autopay_reconcile()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_secret text; v_on boolean; v_test text;
begin
  select coalesce(upi_autopay_enabled, false), coalesce(nullif(btrim(upi_autopay_test_phone), ''), '')
    into v_on, v_test from public.settings where id = 1;
  if not v_on and v_test = '' then return; end if;

  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/sub-charge-upi',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('reconcileOnly', true)
  );
exception when others then null;
end; $$;

commit;
