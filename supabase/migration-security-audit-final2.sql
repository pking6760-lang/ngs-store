-- Corrective: default PUBLIC execute shadows anon/authenticated revokes, so
-- strip PUBLIC and re-grant only the roles that legitimately need each function.

-- partner_penalize: cron/internal (SECURITY DEFINER) only — no direct callers.
revoke execute on function public.partner_penalize(uuid, text, uuid, uuid) from public, anon, authenticated;

-- Partner fulfilment: authenticated partners only; the NULL-safe internal guard
-- restricts to the order's assigned partner (or admin).
revoke execute on function public.partner_mark_delivered(uuid)        from public, anon;
revoke execute on function public.partner_mark_packed(uuid)           from public, anon;
revoke execute on function public.partner_mark_returned(uuid)         from public, anon;
grant  execute on function public.partner_mark_delivered(uuid)        to authenticated;
grant  execute on function public.partner_mark_packed(uuid)           to authenticated;
grant  execute on function public.partner_mark_returned(uuid)         to authenticated;
grant  execute on function public.partner_mark_out_for_delivery(uuid) to authenticated;

-- advance_order_status: staff/admin (authenticated) only; ownership guard inside.
revoke execute on function public.advance_order_status(uuid, text) from public, anon;
grant  execute on function public.advance_order_status(uuid, text) to authenticated;

-- cancel_my_order: signed-in customers only.
revoke execute on function public.cancel_my_order(uuid, text) from public, anon;
grant  execute on function public.cancel_my_order(uuid, text) to authenticated;

-- Also strip any residual PUBLIC on these cron/admin-wrapper functions.
revoke execute on function public.smart_reprice()             from public;
revoke execute on function public.weather_debounce(boolean)   from public;
revoke execute on function public.activate_due_slot_orders()  from public;
revoke execute on function public._reset_stale_presence()     from public;

select 'security-audit-final2 applied' as status;
