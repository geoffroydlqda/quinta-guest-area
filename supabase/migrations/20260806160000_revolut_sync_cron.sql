-- Cron horaire de la synchronisation Revolut Business (6 août 2026).
-- Même mécanique que payment-reminders : pg_cron -> pg_net -> Edge Function,
-- authentifié par x-cron-key (app_settings.internal.cron_key).
-- La fonction répond 200 {connected:false} tant que le consentement OAuth
-- n'a pas été donné (et alerte hello@ par email si la connexion se perd).
select cron.unschedule(jobid) from cron.job where jobname = 'revolut-sync-hourly';
select cron.schedule(
  'revolut-sync-hourly',
  '10 * * * *',
  $$
  select net.http_post(
    url := 'https://fnlgeeuohvethmfpsxpf.supabase.co/functions/v1/revolut-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select value->>'cron_key' from public.app_settings where key = 'internal'), '')
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $$
);
