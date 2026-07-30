-- UPI Autopay — Phase 4: mandate via Razorpay's hosted registration link.
--
-- Razorpay's web Checkout can't complete UPI inside an Android WebView, and
-- Supabase force-serves any HTML we host as text/plain + a sandbox CSP, so we
-- can't host a checkout page either. The fix (in the edge functions) switches
-- mandate collection to Razorpay's OWN hosted 'auth link' (short_url), opened in
-- the system browser. Razorpay requires a ₹1 minimum registration debit; this
-- credits that ₹1 back to the customer's NGS wallet on confirmation, so setup
-- costs the customer nothing net. Idempotent — the credit runs once.

create or replace function public.confirm_upi_mandate(p_order_dbid uuid, p_payment_id text, p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_sub uuid; v_uid uuid; v_rows int;
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

  -- Credit back the ₹1 bank-verification debit — once, the first time the mandate
  -- confirms (the guarded update above runs a single time). Net cost to set up
  -- autopay is therefore ₹0 for the customer.
  if v_rows > 0 and v_uid is not null then
    insert into public.customer_wallet (user_id, amount, kind, note, order_id, created_by)
      values (v_uid, 1, 'adjustment', 'UPI Autopay setup — ₹1 verification credited back', p_order_dbid, v_uid);
  end if;
end; $$;

revoke all on function public.confirm_upi_mandate(uuid, text, text) from public;
