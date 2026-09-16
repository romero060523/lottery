begin;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'caducar-boletos-pendientes',
  '*/5 * * * *',
  $cron$
    set lock_timeout = '5s';
    set statement_timeout = '30s';
    select public.caducar_boletos_pendientes();
  $cron$
);

commit;
