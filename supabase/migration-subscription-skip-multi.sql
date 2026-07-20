-- ════════════════════════════════════════════════════════════════════════════
-- Skip MULTIPLE upcoming deliveries at once ("away for a few days"). Skips the
-- next N deliveries by applying skip_next_delivery N times; the plan extends by
-- N days so the customer still gets every day they paid for.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.skip_deliveries(p_id uuid, p_count int)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_done int := 0; v_n int := greatest(1, least(coalesce(p_count, 1), 14)); d date;
begin
  for i in 1..v_n loop
    begin
      d := public.skip_next_delivery(p_id);
      v_done := v_done + 1;
    exception when others then exit;   -- stop if nothing more can be skipped
    end;
  end loop;
  if v_done = 0 then raise exception 'Couldn''t skip — the plan may be inactive.'; end if;
  return v_done;
end; $function$;
revoke execute on function public.skip_deliveries(uuid, int) from public, anon;
grant execute on function public.skip_deliveries(uuid, int) to authenticated;
