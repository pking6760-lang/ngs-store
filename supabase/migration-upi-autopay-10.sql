-- UPI Autopay Phase 10 — pay the first day's basket at setup (no ₹1 verification).
--
-- Before: setup debited a throwaway ₹1 (credited back to the wallet), and the
-- first real delivery had to wait for the daily engine. But UPI's 24h pre-debit
-- rule means the engine can't charge for a same/next-day slot in time.
--
-- Now: the mandate's authorization transaction charges the customer's ACTUAL
-- first-day basket (approved live with their UPI PIN — no pre-notification
-- needed for the first, customer-present debit). That single payment prepays the
-- first delivery, which is scheduled immediately. Every following day is billed
-- ~26h ahead by the two-phase engine (Phase 9). Money always leads delivery by a
-- day, so the timing lines up exactly.
--
-- The per-debit mandate cap is the exact daily basket (owner's choice) — the
-- customer sees an honest "up to ₹<daily>/day".

-- 1) Mandate cap = exact daily basket (rounded up to the whole rupee), replacing
--    the old daily*1.5-rounded-to-₹10 headroom. Only this one line changes; the
--    rest of create_subscription_order is reproduced verbatim.
create or replace function public.create_subscription_order(p_items jsonb, p_days integer, p_hour integer, p_address text, p_location jsonb, p_pay text)
returns orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_prof public.profiles;
  v_line jsonb; v_prod public.products; v_qty int; v_price numeric;
  v_locked jsonb := '[]'::jsonb; v_items numeric := 0; v_fee numeric; v_daily numeric; v_amount numeric;
  v_days int := greatest(1, least(coalesce(p_days, 7), 30));
  v_hour int := greatest(0, least(coalesce(p_hour, 8), 23));
  v_pay text := lower(coalesce(p_pay, 'wallet'));
  v_plan public.subscriptions;
  v_order public.orders;
  v_code text;
  v_bal numeric;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Choose at least one item.'; end if;
  if v_pay not in ('wallet', 'razorpay', 'wallet_daily', 'upi_autopay') then v_pay := 'wallet'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  v_fee := coalesce((select sub_delivery_fee from public.settings where id = 1), 10);

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_prod from public.products where id = (v_line->>'id') and active;
    if v_prod.id is null then raise exception 'A chosen item is no longer available.'; end if;
    v_price := public.bulk_unit_price(v_prod.price, v_prod.bulk_tiers, v_qty);
    v_locked := v_locked || jsonb_build_object('id', v_prod.id, 'qty', v_qty, 'price', v_price);
    v_items := v_items + v_price * v_qty;
  end loop;
  if v_items <= 0 then raise exception 'Choose at least one item.'; end if;
  v_daily := v_items + v_fee;
  v_amount := v_daily * v_days;

  insert into public.subscriptions (user_id, items, address, location, deliver_hour,
    days_total, daily_total, daily_delivery, amount, pay_method, status,
    mandate_status, mandate_max_amount)
    values (v_uid, v_locked, p_address, p_location, v_hour,
            v_days, v_daily, v_fee, v_amount, v_pay, 'pending',
            case when v_pay = 'upi_autopay' then 'pending' else null end,
            -- Bank cap per debit = the exact daily basket (rounded up to the whole
            -- rupee). Honest "up to ₹<daily>/day" for the customer; the daily debit
            -- is always <= this.
            case when v_pay = 'upi_autopay' then ceil(v_daily) else null end)
    returning * into v_plan;

  v_code := 'NGSSUB' || nextval('public.order_code_seq');
  insert into public.orders (
    human_code, user_id, customer_name, user_phone, status,
    item_total, total, payment_method, payment_status, is_subscription, subscription_id
  ) values (
    v_code, v_uid, v_prof.name, v_prof.phone,
    case when v_pay in ('razorpay', 'upi_autopay') then 'Awaiting payment' else 'Subscription' end,
    v_amount,
    case when v_pay = 'wallet_daily' then 0
         when v_pay = 'upi_autopay' then v_daily   -- the mandate authorises on one day's amount
         else v_amount end,
    v_pay,
    case when v_pay = 'wallet' then 'paid' when v_pay = 'wallet_daily' then 'autopay' else 'pending' end,
    true, v_plan.id
  ) returning * into v_order;

  if v_pay = 'wallet' then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_amount then
      raise exception 'Your wallet has ₹% but the plan costs ₹%. Add money or pay online.',
        floor(v_bal)::text, floor(v_amount)::text;
    end if;
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, -v_amount, 'spent', 'Subscription plan ' || v_code, v_order.id, v_uid);
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_plan.id;
    perform public.sub_generate_due(v_plan.id);

  elsif v_pay = 'wallet_daily' then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 987654321));
    select coalesce(sum(amount), 0) into v_bal from public.customer_wallet where user_id = v_uid;
    if v_bal < v_daily then
      raise exception 'Add at least ₹% to your wallet to start daily auto-pay (one day''s cost). It has ₹%.',
        floor(v_daily)::text, floor(v_bal)::text;
    end if;
    update public.subscriptions set status = 'active',
      start_date = (now() at time zone 'Asia/Kolkata')::date + 1, updated_at = now()
      where id = v_plan.id;
    perform public.sub_generate_due(v_plan.id);

  -- 'upi_autopay': leave the plan PENDING and unpaid. The edge function creates
  -- the Razorpay mandate order; the plan activates only when the webhook confirms
  -- the customer approved it. 'razorpay' (prepay online) also returns here unpaid.
  end if;

  return v_order;
end; $function$;

-- 2) On mandate confirmation, the setup payment IS the first day's payment: book
--    it as that day's paid charge and schedule the delivery, instead of crediting
--    a ₹1 verification.
create or replace function public.confirm_upi_mandate(p_order_dbid uuid, p_payment_id text, p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_sub uuid; v_uid uuid; v_rows int; s public.subscriptions; v_first date; v_made boolean;
begin
  select subscription_id, user_id into v_sub, v_uid from public.orders where id = p_order_dbid;
  if v_sub is null then return; end if;

  update public.orders
    set payment_status = 'paid', status = 'Subscription',
        razorpay_payment_id = coalesce(p_payment_id, razorpay_payment_id)
    where id = p_order_dbid and payment_status <> 'paid';

  update public.subscriptions
    set mandate_token = coalesce(p_token, mandate_token),
        mandate_status = 'confirmed',
        status = case when status = 'pending' then 'active' else status end,
        start_date = coalesce(start_date, (now() at time zone 'Asia/Kolkata')::date + 1),
        updated_at = now()
    where id = v_sub and coalesce(mandate_status, '') <> 'confirmed';
  get diagnostics v_rows = row_count;

  -- Only on the first confirmation (guarded by mandate_status flip) do we book the
  -- first day, so a duplicate webhook can't create two deliveries or double-count.
  if v_rows > 0 and v_uid is not null then
    select * into s from public.subscriptions where id = v_sub;
    v_first := public.sub_upi_next_deliver(s);   -- the first delivery slot (= start_date)

    if v_first is not null then
      -- The live-approved setup debit prepays this first delivery. Record it paid
      -- (idempotent) and schedule the order — exactly what settle_success does for
      -- later days, minus the extra debit.
      insert into public.subscription_charges (subscription_id, deliver_date, amount, status, rzp_payment_id)
        values (v_sub, v_first, s.daily_total, 'paid', p_payment_id)
        on conflict (subscription_id, deliver_date) do nothing;

      v_made := public._sub_create_order(s, v_first);
      if v_made then
        update public.subscriptions
          set days_done = days_done + 1, last_delivery = v_first, updated_at = now()
          where id = v_sub;
        update public.subscriptions
          set status = 'completed', updated_at = now()
          where id = v_sub and days_done >= days_total and status = 'active';
      end if;
    end if;

    insert into public.notifications (user_id, title, body) values
      (v_uid, 'UPI Autopay is set up',
       'Your daily plan is active. You''ve paid ₹' || floor(coalesce(s.daily_total, 0))::text ||
       ' for your first delivery, and from now on your bank auto-pays each day''s amount a day before delivery.');
  end if;
end; $function$;
