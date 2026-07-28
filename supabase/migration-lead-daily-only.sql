-- The 15-minute head start belongs to the daily round only.
--
-- The owner's call, and it is the right one. A daily delivery is a promise to
-- be somewhere at 8:00 sharp, so the shop needs to be moving at 7:45. A
-- customer-booked order is a WINDOW -- "Tomorrow 10 AM–12 PM" -- and starting
-- it at 9:45 buys nothing while putting an order on the active screen a quarter
-- of an hour before anyone can act on it.
--
-- WHAT IS NOT CHANGING: an ordinary scheduled order still rings. It rings at
-- its slot time instead of before it. That distinction matters -- the silent
-- miss this whole thread began with was NGS1534, a customer's "Tomorrow 10 AM"
-- order that went live and was never announced at all. Narrowing the head start
-- must not quietly hand that bug back.
--
--   daily subscription round   goes live 7:45, rings 7:45 if no rider
--   customer-booked slot       goes live 10:00, rings 10:00 if no rider

begin;

comment on column public.ops_config.prep_lead_minutes is
  'Minutes of head start for a DAILY subscription round: it goes live this early and, if no rider has it, the alarm rings this early. Customer-booked slot orders are not affected -- they go live and ring at their slot time.';

-- Customer-booked slots: live at the slot, not before it.
create or replace function public.activate_due_slot_orders()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_n int;
begin
  with due as (
    update public.orders set status = 'Placed'
     where status = 'Scheduled'
       and subscription_id is null
       and not coalesce(is_subscription, false)
       and deliver_on is not null
       and deliver_on <= v_today
       -- No head start here. prep_lead_minutes is the daily round's alone.
       and now() >= public._slot_start(deliver_on, coalesce(deliver_hour, 8))
     returning id
  )
  select count(*) into v_n from due;
  return coalesce(v_n, 0);
end $$;

-- The alarm: early for the round, on time for everyone else.
create or replace function public.ring_owner_due_deliveries()
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare cfg public.ops_config; v_lead interval; v_secret text;
        v_today date := (now() at time zone 'Asia/Kolkata')::date;
        v_url text := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-admin';
        r record; v_n int := 0; v_when text; v_title text; v_body text;
begin
  select * into cfg from public.ops_config where id = 1;
  v_lead := make_interval(mins => coalesce(cfg.prep_lead_minutes, 15));
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  if v_secret is null or v_secret = '' then return 0; end if;

  for r in
    with claimed as (
      update public.orders o
         set owner_alarm_at = now(), needs_owner = true
       where o.owner_alarm_at is null
         and o.id in (
           select x.id from public.orders x
            where x.deliver_on = v_today
              and x.owner_alarm_at is null
              and x.status in ('Placed', 'Packed')
              and not coalesce(x.is_membership, false)
              and not coalesce(x.is_topup, false)
              and not coalesce(x.is_return, false)
              and now() < public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8)) + interval '90 minutes'
              and (
                -- Nobody has it. The daily round gets its head start; a
                -- customer-booked slot is judged at the slot itself.
                (x.rider_id is null
                 and now() >= public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8))
                             - case when x.subscription_id is not null
                                     and not coalesce(x.is_subscription, false)
                                    then v_lead else interval '0' end)
                -- Someone was given it and never accepted, and the slot is here.
                or (coalesce(x.delivery_state, 'unassigned') <> 'accepted'
                    and now() >= public._slot_start(x.deliver_on, coalesce(x.deliver_hour, 8)))
              ))
      returning o.id, o.human_code, o.total, o.customer_name, o.payment_method,
                coalesce(o.deliver_hour, 8) as dh,
                (o.subscription_id is not null and not coalesce(o.is_subscription, false)) as is_daily
    )
    select c.is_daily, c.dh,
           count(*)::int                                       as cnt,
           sum(c.total)                                        as amount,
           sum(case when lower(coalesce(c.payment_method,'')) = 'cod'
                    then c.total else 0 end)                   as cash,
           min(c.human_code)                                   as human_code,
           min(c.customer_name)                                as customer_name,
           min(lower(coalesce(c.payment_method,'')))           as pay
      from claimed c
     group by c.is_daily, c.dh, case when c.is_daily then null else c.id::text end
     order by c.dh
  loop
    v_when := to_char(public._slot_start(v_today, r.dh) at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
    if r.is_daily then
      v_title := '🥛 Daily delivery — ' || v_when;
      v_body  := r.cnt || case when r.cnt = 1 then ' delivery' else ' deliveries' end
                 || ' · ₹' || trim(to_char(coalesce(r.amount,0), 'FM999999990.00'))
                 || case when coalesce(r.cash,0) > 0
                         then ' · 💵 collect ₹' || trim(to_char(r.cash, 'FM999999990.00')) else '' end
                 || ' · no rider — it''s yours';
    else
      v_title := '⏰ Scheduled order — ' || v_when;
      v_body  := coalesce(r.human_code, '') || ' · ' || coalesce(r.customer_name, 'A customer')
                 || ' · ₹' || trim(to_char(coalesce(r.amount,0), 'FM999999990.00'))
                 || case when r.pay = 'cod' then ' · 💵 collect cash' else ' · ✅ paid' end
                 || ' · no rider — it''s yours';
    end if;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
      body := jsonb_build_object('type','DUE','title', v_title, 'body', v_body,
                                 'record', jsonb_build_object('human_code',
                                   case when r.is_daily then 'daily' else r.human_code end)));
    v_n := v_n + 1;
  end loop;

  return v_n;
end; $$;

revoke all on function public.ring_owner_due_deliveries() from public, anon, authenticated, service_role;

commit;
