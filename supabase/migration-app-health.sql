-- ════════════════════════════════════════════════════════════════════════════
-- App health check — catch performance/regression problems early (like product
-- photos creeping back into the database and bloating the list payload).
--   • app_health()      : admin-only snapshot of key checks (green/warn/red).
--   • run_health_check(): daily cron; if something's wrong, drops an alert into
--                         the admin's notifications so it's spotted early.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.app_health()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_base64 int; v_payload bigint; v_biggest int; v_products int; v_bucket boolean; v_checks jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select
    count(*) filter (where image_url like 'data:%'),
    coalesce(sum(octet_length(coalesce(image_url,''))),0) + count(*) * 350,
    coalesce(max(octet_length(coalesce(image_url,''))),0),
    count(*)
  into v_base64, v_payload, v_biggest, v_products
  from public.products;
  select exists(select 1 from storage.buckets where id = 'product-images' and public) into v_bucket;

  v_checks := jsonb_build_array(
    jsonb_build_object('key','base64_images','label','Photos stored inside the database','value',v_base64,'unit','',
      'status', case when v_base64 = 0 then 'ok' else 'fail' end,
      'hint','Should be 0 — photos belong in Storage. If not, upload photos from the latest Admin app.'),
    jsonb_build_object('key','payload','label','Product list download size','value',round(v_payload/1024.0),'unit','KB',
      'status', case when v_payload < 400*1024 then 'ok' when v_payload < 1024*1024 then 'warn' else 'fail' end,
      'hint','What every app downloads to show products. Keep it small so the app opens fast even on weak signal.'),
    jsonb_build_object('key','biggest','label','Biggest single product record','value',round(v_biggest/1024.0),'unit','KB',
      'status', case when v_biggest < 5*1024 then 'ok' when v_biggest < 50*1024 then 'warn' else 'fail' end,
      'hint','A big record means a photo slipped into the database instead of Storage.'),
    jsonb_build_object('key','storage','label','Image storage','value', case when v_bucket then 'Ready' else 'Not set' end,'unit','',
      'status', case when v_bucket then 'ok' else 'fail' end,
      'hint','The Storage bucket that holds product photos.'),
    jsonb_build_object('key','products','label','Products in catalogue','value',v_products,'unit','',
      'status','ok','hint','Total products.')
  );
  return jsonb_build_object(
    'overall', case when v_checks @> '[{"status":"fail"}]' then 'fail'
                    when v_checks @> '[{"status":"warn"}]' then 'warn' else 'ok' end,
    'checks', v_checks,
    'at', now()
  );
end; $function$;
revoke execute on function public.app_health() from public, anon;
grant execute on function public.app_health() to authenticated;

-- Daily automatic check → alert the admin only when something is actually wrong.
create or replace function public.run_health_check()
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_base64 int; v_payload bigint; v_msg text := '';
begin
  select count(*) filter (where image_url like 'data:%'),
         coalesce(sum(octet_length(coalesce(image_url,''))),0) + count(*) * 350
    into v_base64, v_payload from public.products;
  if v_base64 > 0 then
    v_msg := v_base64 || ' product photo(s) are stored in the database again — upload them from the latest Admin app. ';
  end if;
  if v_payload > 1024*1024 then
    v_msg := v_msg || 'Product list download is ' || round(v_payload/1024.0/1024, 1) || ' MB — the app may be slow.';
  end if;
  if v_msg <> '' then
    insert into public.notifications (user_id, title, body)
      select id, '⚠️ App health', v_msg from public.profiles where role = 'admin';
  end if;
end; $function$;
revoke execute on function public.run_health_check() from public, anon, authenticated;

select cron.unschedule('app-health') where exists (select 1 from cron.job where jobname='app-health');
select cron.schedule('app-health', '0 4 * * *', 'select public.run_health_check()');  -- ~09:30 IST daily
