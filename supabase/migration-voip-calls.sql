-- ════════════════════════════════════════════════════════════════════════════
-- In-app VoIP calling (masked): driver ↔ customer talk over the internet, no
-- phone number ever exposed. This table only carries the CALL STATE + signalling
-- handshake trigger; the audio itself is peer-to-peer WebRTC, and the SDP/ICE
-- exchange rides Supabase Realtime broadcast on channel "call-<id>".
--
--   • calls: one row per call, caller/callee + status (ringing→accepted→ended).
--   • call_order_party(order): call the OTHER side of an order you're part of —
--     a rider/owner rings the customer; the customer rings their rider. The
--     callee is derived server-side, so neither app needs the other's identity.
--   • set_call_status: accept / decline / end, only by a party to the call.
--   • placing a call fires call-ring (pg_net) to push the callee's devices.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id   uuid not null,
  callee_id   uuid not null,
  caller_name text,
  caller_role text,                                   -- partner | customer | owner
  order_id    uuid,
  status      text not null default 'ringing'
              check (status in ('ringing','accepted','declined','ended','missed','failed','busy')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  ended_at    timestamptz
);
create index if not exists calls_callee_idx on public.calls (callee_id, status, created_at desc);
create index if not exists calls_caller_idx on public.calls (caller_id, created_at desc);

alter table public.calls enable row level security;
drop policy if exists calls_sel on public.calls;
create policy calls_sel on public.calls for select
  using (auth.uid() = caller_id or auth.uid() = callee_id);
-- Writes go through SECURITY DEFINER RPCs only.
revoke all on public.calls from anon;
grant select on public.calls to authenticated;

-- Live ring while the app is OPEN: the callee's client subscribes to inserts.
do $$ begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null; end $$;

-- The shop owner's user id (first admin) — used when a customer calls and no
-- rider is assigned yet, so the call rings the shop.
create or replace function public._shop_owner_id()
 returns uuid language sql security definer set search_path to 'public' as $$
  select id from public.profiles where role = 'admin' order by created_at asc limit 1;
$$;
revoke execute on function public._shop_owner_id() from public, anon;

-- Ring a device set for an incoming call (pg_net → call-ring edge function).
create or replace function public._ring_call(p_call public.calls)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secret text;
begin
  select value into v_secret from private.app_secret where key = 'webhook_secret';
  perform net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/call-ring',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'callId', p_call.id, 'calleeId', p_call.callee_id,
      'callerName', coalesce(p_call.caller_name, 'NGS'), 'callerRole', coalesce(p_call.caller_role,''))
  );
end; $function$;
revoke execute on function public._ring_call(public.calls) from public, anon, authenticated;

-- Call the OTHER party on an order you belong to. Callee is derived here, so
-- the caller never learns the other side's phone or identity.
create or replace function public.call_order_party(p_order uuid)
 returns public.calls language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); o public.orders; v_callee uuid; v_name text; v_role text; v_call public.calls;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;

  if v_uid = o.user_id then
    -- Customer → rings their rider, or the shop if none assigned yet.
    v_callee := coalesce(o.rider_id, public._shop_owner_id());
    v_role := 'customer';
  elsif v_uid = o.rider_id or v_uid = o.picker_id or public.is_admin() then
    -- Rider / picker / owner → rings the customer.
    v_callee := o.user_id;
    v_role := case when v_uid = o.rider_id or v_uid = o.picker_id then 'partner' else 'owner' end;
  else
    raise exception 'You are not part of this order.';
  end if;
  if v_callee is null or v_callee = v_uid then raise exception 'No one to call on this order yet.'; end if;

  v_name := coalesce(
    (select full_name from public.partners where user_id = v_uid),
    (select name from public.profiles where id = v_uid), 'NGS');
  if v_role = 'customer' then v_name := coalesce((select name from public.profiles where id = v_uid), 'Customer'); end if;

  insert into public.calls (caller_id, callee_id, caller_name, caller_role, order_id)
    values (v_uid, v_callee, v_name, v_role, p_order) returning * into v_call;
  perform public._ring_call(v_call);
  return v_call;
end; $function$;
revoke execute on function public.call_order_party(uuid) from public, anon;
grant execute on function public.call_order_party(uuid) to authenticated;

-- Accept / decline / end a call — only by a party to it. Timestamps the change.
create or replace function public.set_call_status(p_call uuid, p_status text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); c public.calls;
begin
  if p_status not in ('accepted','declined','ended','missed','busy') then
    raise exception 'bad status';
  end if;
  select * into c from public.calls where id = p_call;
  if c.id is null then return; end if;
  if v_uid <> c.caller_id and v_uid <> c.callee_id then raise exception 'Not your call.'; end if;
  update public.calls set
    status = p_status,
    answered_at = case when p_status = 'accepted' and answered_at is null then now() else answered_at end,
    ended_at = case when p_status in ('ended','declined','missed','busy') then now() else ended_at end
  where id = p_call;
end; $function$;
revoke execute on function public.set_call_status(uuid, text) from public, anon;
grant execute on function public.set_call_status(uuid, text) to authenticated;

select 'voip calls migration applied' as status;
