begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'Falta pg_cron: habilítalo antes de programar la caducidad'
      using errcode = '55000', hint = 'Producción: Dashboard > Integrations > Cron. Desarrollo local: consulta supabase/README.md. No se creó ni modificó el job.';
  end if;

  if not has_schema_privilege(current_user, 'cron', 'USAGE')
    or not has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    raise exception 'El rol de migraciones necesita USAGE sobre cron y EXECUTE sobre cron.schedule'
      using errcode = '42501';
  end if;
end;
$$;

select cron.schedule(
  'caducar-boletos-pendientes',
  '*/5 * * * *',
  $cron$
    set lock_timeout = '5s';
    set statement_timeout = '2min';
    select public.caducar_boletos_pendientes();
  $cron$
);

commit;
