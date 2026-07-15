-- ═══════════════════════════════════════════════════════════════════════════
-- NGS Partner — hard-alarm push: token registration + fire on assignment.
-- The notify-partner edge function sends the FCM push (reuses the admin's
-- FIREBASE_SERVICE_ACCOUNT). Dispatch calls it the moment a partner is assigned.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.save_partner_token(p_token text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  insert into public.partner_devices (user_id, fcm_token, platform, updated_at)
    values (auth.uid(), p_token, 'android', now())
  on conflict (fcm_token) do update set user_id = excluded.user_id, updated_at = now();
end; $$;
grant execute on function public.save_partner_token(text) to authenticated;

create or replace function public._notify_partner(p_user uuid, p_role text, p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/notify-partner',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret','94075e1969c27b54b99c866927cf19a9'),
    body := jsonb_build_object(
      'userId', p_user, 'role', p_role,
      'code', (select human_code from public.orders where id = p_order),
      'isCod', (lower(coalesce((select payment_method from public.orders where id = p_order),'')) = 'cod'),
      'total', (select total from public.orders where id = p_order))
  );
exception when others then null;
end; $$;

-- dispatch_order now rings the assigned partner (see migration-partner-dispatch
-- for the base version; this adds the _notify_partner calls).
create or replace function public.dispatch_order(p_order uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare cfg public.ops_config; v_uid uuid;
begin
  select * into cfg from public.ops_config where id = 1;
  if cfg.coverage_delivery = 'staff' and (select rider_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('delivery', p_order);
    if v_uid is not null then
      update public.orders set rider_id = v_uid, delivery_state = 'assigned', rider_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'delivery', p_order);
    end if;
  end if;
  if cfg.coverage_picking = 'staff' and (select picker_id from public.orders where id = p_order) is null then
    v_uid := public.pick_partner('picker', p_order);
    if v_uid is not null then
      update public.orders set picker_id = v_uid, picker_state = 'assigned', picker_assigned_at = now() where id = p_order;
      update public.partner_presence set active_order_id = p_order where user_id = v_uid;
      perform public._notify_partner(v_uid, 'picker', p_order);
    end if;
  end if;
end; $$;
