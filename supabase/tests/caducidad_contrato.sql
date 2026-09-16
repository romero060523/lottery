-- Ejecutar únicamente en desarrollo después de las migraciones.
-- pnpm supabase test db supabase/tests/caducidad_contrato.sql
-- Contrato de la caducidad verificado a mano en revisiones anteriores y que
-- caducidad_regresion.sql no fija: plazos, P1002, motivos, service_role,
-- aislamiento de errores de fila y superficie no expuesta.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
-- Aísla el job de datos previos de la base y de una corrida concurrente de cron.
select pg_advisory_xact_lock(hashtextextended('public.caducar_boletos_pendientes', 0));
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() where estado = 'pendiente';
alter table public.boletos enable trigger trg_registrar_revision_boleto;

insert into auth.users (id) values ('93000000-0000-4000-8000-000000000001');
insert into public.admins (user_id, nombre) values ('93000000-0000-4000-8000-000000000001', 'Admin contrato TTL');
insert into public.sorteos (id, edicion_numero, nombre, precio_boleto, tickets_totales) values
  ('94000000-0000-4000-8000-000000000001', 910001, 'Plazos', 5000, 100),
  ('94000000-0000-4000-8000-000000000002', 910002, 'Aislamiento por fila', 5000, 100);

create temporary table casos (nombre text primary key, id uuid not null);
grant select on casos to authenticated, service_role;
insert into casos select 'vuelve', id from public.comprar_tickets('94000000-0000-4000-8000-000000000001', 1, 'a', '1', 'cedula', '1');
insert into casos select 'umbral', id from public.comprar_tickets('94000000-0000-4000-8000-000000000001', 1, 'b', '2', 'cedula', '2');
insert into casos select 'caduca', id from public.comprar_tickets('94000000-0000-4000-8000-000000000001', 1, 'c', '3', 'cedula', '3');
insert into casos select 'fila_1', id from public.comprar_tickets('94000000-0000-4000-8000-000000000002', 1, 'd', '4', 'cedula', '4');
insert into casos select 'fila_falla', id from public.comprar_tickets('94000000-0000-4000-8000-000000000002', 1, 'e', '5', 'cedula', '5');
insert into casos select 'fila_3', id from public.comprar_tickets('94000000-0000-4000-8000-000000000002', 1, 'f', '6', 'cedula', '6');

-- TTL entre 1 y 168 horas
select throws_ok($$update public.sorteos set ttl_pendientes_horas = 0 where edicion_numero = 910001$$,
  '23514', null, 'TTL 0 se rechaza');
select throws_ok($$update public.sorteos set ttl_pendientes_horas = 169 where edicion_numero = 910001$$,
  '23514', null, 'TTL 169 se rechaza');
select lives_ok($$update public.sorteos set ttl_pendientes_horas = 1 where edicion_numero = 910001$$, 'TTL 1 es válido');
select lives_ok($$update public.sorteos set ttl_pendientes_horas = 168 where edicion_numero = 910001$$, 'TTL 168 es válido');
update public.sorteos set ttl_pendientes_horas = 24 where edicion_numero = 910001;

-- Plazo desde cada entrada a pendiente y umbral estricto
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '30 days'
where id = (select id from casos where nombre = 'vuelve');
update public.boletos set pendiente_desde = statement_timestamp() - interval '24 hours' + interval '1 minute'
where id = (select id from casos where nombre = 'umbral');
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where id = (select id from casos where nombre = 'caduca');
alter table public.boletos enable trigger trg_registrar_revision_boleto;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'vuelve');
update public.boletos set estado = 'pendiente' where id = (select id from casos where nombre = 'vuelve');
select ok((select pendiente_desde > statement_timestamp() - interval '1 minute'
  from public.boletos where id = (select id from casos where nombre = 'vuelve')),
  'Volver de validado a pendiente concede un plazo completo');
update public.boletos set estado = 'pendiente' where id = (select id from casos where nombre = 'caduca');
select ok((select pendiente_desde < statement_timestamp() - interval '24 hours'
  from public.boletos where id = (select id from casos where nombre = 'caduca')),
  'Guardar pendiente sin cambio de estado conserva el inicio');
select throws_ok($$update public.boletos set pendiente_desde = now() where id = (select id from casos where nombre = 'caduca')$$,
  '42501', null, 'La API no escribe pendiente_desde');
reset role;
-- Sin claim: con un admin en la sesión, el trigger registraría un rechazo manual.
select set_config('request.jwt.claim.sub', '', true);

select is(public.caducar_boletos_pendientes(), 1, 'Solo caduca el pendiente con antigüedad mayor al TTL');
select ok((select estado = 'pendiente' from public.boletos where id = (select id from casos where nombre = 'umbral')),
  'Un minuto antes del umbral no caduca');
select ok((select validado_por = 'sistema:caducidad' and validado_en is not null and motivo_rechazo = 'caducidad'
  from public.boletos where id = (select id from casos where nombre = 'caduca')),
  'La caducidad registra autor, fecha y motivo');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 910001), 2,
  'La caducidad libera exactamente su reserva');

-- P1002: el admin revisa después de que ganó la caducidad
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select throws_ok($$update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'caduca')$$,
  'P1002', null, 'Validar un boleto ya caducado exige recargar');

-- Corrección auditada del motivo
update public.boletos set motivo_rechazo = 'manual' where id = (select id from casos where nombre = 'caduca');
select ok((select motivo_rechazo = 'manual' and motivo_corregido_por = '93000000-0000-4000-8000-000000000001'
    and motivo_corregido_en is not null and validado_por = 'sistema:caducidad'
  from public.boletos where id = (select id from casos where nombre = 'caduca')),
  'El admin corrige el motivo con auditoría sin tocar la revisión');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 910001), 2,
  'Corregir el motivo no toca el contador');
select throws_ok($$update public.boletos set motivo_rechazo = 'otro' where id = (select id from casos where nombre = 'caduca')$$,
  '23514', null, 'Un motivo inválido falla');
-- Sin admin, la RLS de boletos deja la actualización en cero filas.
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
update public.boletos set motivo_rechazo = 'servicio' where id = (select id from casos where nombre = 'caduca');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select motivo_rechazo from public.boletos where id = (select id from casos where nombre = 'caduca')), 'manual',
  'Un usuario sin admin no corrige el motivo');

-- Origen cerrado para service_role
set local role service_role;
select throws_ok($$insert into public.boletos (sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento, cantidad_comprada, monto_total)
  values ('94000000-0000-4000-8000-000000000001', 'x', '1', 'cedula', '1', 1, 5000)$$,
  '42501', null, 'service_role no inserta boletos');
select throws_ok($$delete from public.boletos where id = (select id from casos where nombre = 'fila_1')$$,
  '42501', null, 'service_role no borra boletos');
select throws_ok($$truncate public.boletos cascade$$, '42501', null, 'service_role no trunca boletos');
select throws_ok($$update public.boletos set cantidad_comprada = 5 where id = (select id from casos where nombre = 'fila_1')$$,
  '42501', null, 'service_role no cambia cantidades');
select throws_ok($$update public.boletos set motivo_rechazo = 'manual' where id = (select id from casos where nombre = 'caduca')$$,
  '42501', null, 'service_role no corrige motivos');
select lives_ok($$update public.boletos set estado = 'rechazado', validado_por = 'ocr:nequi' where id = (select id from casos where nombre = 'umbral')$$,
  'service_role rechaza identificando al responsable');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select ok((select motivo_rechazo = 'servicio' from public.boletos where id = (select id from casos where nombre = 'umbral')),
  'El rechazo de servicio registra su motivo');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 910001), 1,
  'El rechazo de servicio libera su reserva');

-- Un error ordinario de fila no detiene al resto de una edición sana
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where sorteo_id = '94000000-0000-4000-8000-000000000002';
alter table public.boletos enable trigger trg_registrar_revision_boleto;
-- Se ordena después del liberador: si su liberación no se revierte, el contador lo delata.
create function public.prueba_falla_forzada() returns trigger language plpgsql as $$
begin
  if new.id = (select id from pg_temp.casos where nombre = 'fila_falla') then
    raise exception 'fallo forzado de fila';
  end if;
  return new;
end;
$$;
create trigger zz_prueba_falla_forzada before update of estado on public.boletos
  for each row execute function public.prueba_falla_forzada();
select is(public.caducar_boletos_pendientes(), 2, 'Un error de fila no detiene a las demás de la edición');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 910002), 1,
  'La fila fallida revierte también la liberación de su trigger');
select ok((select codigo_error = 'P0001'
    and reintentar_desde between statement_timestamp() + interval '59 minutes' and statement_timestamp() + interval '61 minutes'
  from public.incidencias_caducidad where boleto_id = (select id from casos where nombre = 'fila_falla')),
  'La fila fallida se aplaza una hora');
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 910002), 0::bigint,
  'Un error ordinario no pone la edición en cuarentena');

-- Superficie no expuesta y job único
select ok(not has_function_privilege('anon', 'public.caducar_boletos_pendientes()', 'EXECUTE'),
  'anon no ejecuta la caducidad');
select ok(not has_function_privilege('authenticated', 'public.caducar_boletos_pendientes()', 'EXECUTE'),
  'authenticated no ejecuta la caducidad');
select ok(not has_function_privilege('service_role', 'public.caducar_boletos_pendientes()', 'EXECUTE'),
  'service_role no ejecuta la caducidad');
select is((select count(*) from cron.job where jobname = 'caducar-boletos-pendientes'
  and schedule = '*/5 * * * *' and active), 1::bigint, 'Un único job activo cada cinco minutos');

select * from finish();
rollback;
