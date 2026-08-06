-- migration-store-qr-cron.sql
-- Scheduled reconciliation for the Store QR.
--
-- The Razorpay webhook (qr_code.credited) is the instant path, but Razorpay does
-- not always deliver that event for every payment. This cron pulls any missed
-- payments in from Razorpay once a minute so history + the soundbox never depend
-- on the webhook alone.
--
-- Prereq: set a shared secret on the store-qr edge function and use the SAME
-- value below (shown here as a placeholder — do NOT commit the real value):
--   supabase secrets set STORE_QR_CRON_SECRET=<random-secret>
-- The store-qr function accepts { action:"sync" } with header
--   x-store-cron: <STORE_QR_CRON_SECRET>
-- and no user JWT, syncing every store QR.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('store-qr-reconcile')
  where exists (select 1 from cron.job where jobname = 'store-qr-reconcile');

select cron.schedule('store-qr-reconcile', '* * * * *', $job$
  select net.http_post(
    url := 'https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1/store-qr',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-store-cron', '<STORE_QR_CRON_SECRET>'),
    body := jsonb_build_object('action', 'sync')
  );
$job$);
