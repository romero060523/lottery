-- Ejecutar únicamente en desarrollo después de las migraciones.
-- pnpm supabase test db supabase/tests/caducidad_regresion.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
-- Aísla el job de datos previos de la base (pendientes vencidos de desarrollo)
-- y de una corrida concurrente de cron: el lock advisory es reentrante en esta
-- sesión, así que las llamadas de la prueba lo obtienen y cron devuelve 0.
select pg_advisory_xact_lock(hashtextextended('public.caducar_boletos_pendientes', 0));
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() where estado = 'pendiente';
alter table public.boletos enable trigger trg_registrar_revision_boleto;

insert into auth.users (id) values ('91000000-0000-4000-8000-000000000001');
insert into public.admins (user_id, nombre)
values ('91000000-0000-4000-8000-000000000001', 'Admin de prueba TTL');

insert into public.sorteos (id, edicion_numero, nombre, precio_boleto, tickets_totales)
values
  ('92000000-0000-4000-8000-000000000001', 900001, 'Contador inconsistente', 5000, 100),
  ('92000000-0000-4000-8000-000000000002', 900002, 'Rechazo múltiple', 5000, 100),
  ('92000000-0000-4000-8000-000000000003', 900003, 'Caducidad sana', 5000, 100);

create temporary table casos (nombre text primary key, id uuid not null);
grant select on casos to authenticated;
insert into casos
select 'legitimo', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000001', 8, 'Prueba', '1', 'cedula', '1');

-- Simula el INSERT heredado que no reservó cupo: 10 contados, 20 en boletos.
with boleto as (
  insert into public.boletos (
    sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
    cantidad_comprada, cantidad_gratis, monto_total
  ) values ('92000000-0000-4000-8000-000000000001', 'Huérfano', '2', 'cedula', '2', 8, 2, 40000)
  returning id
)
insert into casos select 'huerfano', id from boleto;

insert into casos
select 'multiple_1', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000002', 4, 'Prueba', '3', 'cedula', '3');
insert into casos
select 'multiple_2', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000002', 8, 'Prueba', '4', 'cedula', '4');
insert into casos
select 'sano_job', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000003', 4, 'Prueba', '5', 'cedula', '5');

-- Solo el fixture puede retroceder el reloj de pendientes, nunca la API.
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where id in (select id from casos where nombre in ('huerfano', 'sano_job'));
alter table public.boletos enable trigger trg_registrar_revision_boleto;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'huerfano')$$,
  'P1003', 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación',
  'M1: rechazar el huérfano no libera tickets ajenos');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900001), 10,
  'M1: se conservan los 10 tickets reservados');
select is((select estado from public.boletos where id = (select id from casos where nombre = 'huerfano')),
  'pendiente', 'M1: el rechazo fallido revierte el estado');
select ok((select validado_por is null and validado_en is null and motivo_rechazo is null
  from public.boletos where id = (select id from casos where nombre = 'huerfano')),
  'M1: el rechazo fallido conserva auditoría y motivo');
select throws_ok(
  $$update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'legitimo')$$,
  'P1003', 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación',
  'M1: la guarda protege toda la edición inconsistente');

select lives_ok(
  $$update public.boletos set estado = 'rechazado' where sorteo_id = '92000000-0000-4000-8000-000000000002'$$,
  'M1: un UPDATE de varios boletos sanos funciona');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900002), 0,
  'M1: libera comprados más gratis de todas las filas');
select is((select count(*) from public.boletos where sorteo_id = '92000000-0000-4000-8000-000000000002'
  and estado = 'rechazado' and motivo_rechazo = 'manual'
  and validado_por = 'admin:91000000-0000-4000-8000-000000000001'), 2::bigint,
  'M1: conserva motivo y auditoría manual en ambas filas');
update public.boletos set estado = 'rechazado'
where sorteo_id = '92000000-0000-4000-8000-000000000002';
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900002), 0,
  'M1: repetir rechazo no libera otra vez');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select is(public.caducar_boletos_pendientes(), 1, 'El job libera la edición sana y aparta la inconsistente');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900003), 0,
  'El trigger sigue liberando el cupo del job');
select is((select motivo_rechazo from public.boletos where id = (select id from casos where nombre = 'sano_job')),
  'caducidad', 'El job conserva su motivo');
select is((select codigo_error from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), 'P1003', 'Se registra el desajuste');

-- Una cuarentena P1003 bloquea la RPC pública sin abrir datos operativos.
select ok(has_function_privilege('anon', 'public.sorteo_en_cuarentena(uuid)', 'EXECUTE'),
  'anon puede consultar solo el booleano de cuarentena');
set local role anon;
select is(public.sorteo_en_cuarentena('92000000-0000-4000-8000-000000000001'), true,
  'El booleano público refleja la cuarentena P1003');
select throws_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000001', 51,
    'Compra bloqueada', '6', 'cedula', '6')$$,
  'P1004', 'La venta de esta edición está pausada mientras se concilian sus reservas',
  'P1004 prevalece y distingue la pausa del tope P1001');
select throws_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000002', 51,
    'Compra con tope', '7', 'cedula', '7')$$,
  'P1001', 'La cantidad comprada supera el máximo de 50 tickets por compra',
  'Una edición sana conserva P1001 para el tope');
reset role;
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900001), 10,
  'La compra bloqueada no modifica el contador');
select is((select count(*) from public.boletos where sorteo_id = '92000000-0000-4000-8000-000000000001'),
  2::bigint, 'La compra bloqueada no crea boleto');

-- La contención 55P03 es transitoria: se informa al admin, pero no pausa ventas.
insert into casos
select 'contencion', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000002', 1, 'Contención', '8', 'cedula', '8');
insert into public.incidencias_caducidad (
  boleto_id, sorteo_id, codigo_error, mensaje, primera_incidencia_en, registrado_en, reintentar_desde
)
select id, '92000000-0000-4000-8000-000000000002', '55P03', 'Lock transitorio',
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '10 minutes'
from casos where nombre = 'contencion';
set local role anon;
select is(public.sorteo_en_cuarentena('92000000-0000-4000-8000-000000000002'), false,
  '55P03 no pone la edición en cuarentena de venta');
select lives_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000002', 1,
    'Venta habilitada', '9', 'cedula', '9')$$,
  'Una incidencia 55P03 no bloquea la venta');
reset role;

create temporary table primera_deteccion as
select primera_incidencia_en from public.incidencias_caducidad
where boleto_id = (select id from casos where nombre = 'huerfano');
update public.incidencias_caducidad set reintentar_desde = statement_timestamp() - interval '1 second';
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 1::bigint,
  'La cuarentena sigue visible aunque ya sea elegible para reintento');
select is(public.caducar_boletos_pendientes(), 0, 'Un reintento fallido conserva el contador');
select is((select primera_incidencia_en from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), (select primera_incidencia_en from primera_deteccion),
  'Los reintentos conservan desde cuándo existe el fallo');
select is((select intentos from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), 2, 'Los reintentos incrementan el diagnóstico');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.ediciones_en_cuarentena), 0::bigint,
  'Un usuario autenticado sin admin no ve cuarentenas');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 1::bigint,
  'El admin ve la edición en cuarentena');
select ok((select cuarentena_desde is not null and ultimo_fallo_en >= cuarentena_desde
  and motivos->0->>'codigo_error' = 'P1003' and motivos->0->>'mensaje' like '%conciliación%'
  from public.ediciones_en_cuarentena where edicion_numero = 900001),
  'La vista expone fecha, código y motivo consultables por el panel');
select throws_ok($$delete from public.incidencias_caducidad$$, '42501',
  'permission denied for table incidencias_caducidad', 'El admin no borra incidencias directamente');
reset role;
set local role anon;
select throws_ok($$select * from public.ediciones_en_cuarentena$$, '42501',
  'permission denied for view ediciones_en_cuarentena', 'Anon no accede a la vista');
reset role;

savepoint validacion;
set local role authenticated;
update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'huerfano');
do $$
begin
  if exists (select 1 from public.incidencias_caducidad where boleto_id =
    (select id from casos where nombre = 'huerfano')) then
    raise exception 'Validar debe resolver la incidencia dentro de su transacción';
  end if;
end;
$$;
rollback to validacion;
-- Emitir TAP fuera del savepoint para no revertir el contador de pruebas.
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), 1::bigint,
  'Revertir la validación restaura la incidencia');
set local role authenticated;
update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'huerfano');
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), 0::bigint, 'La validación confirmable resuelve la incidencia');
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 0::bigint,
  'La incidencia resuelta desaparece de la vista');
select is(public.sorteo_en_cuarentena('92000000-0000-4000-8000-000000000001'), false,
  'Resolver la incidencia limpia también el booleano público');
select throws_ok(
  $$update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'huerfano')$$,
  'P1003', 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación',
  'M1: validado a rechazado también exige contador consistente');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Un registro tardío/huérfano no puede aplazar otra reserva de la edición.
insert into public.incidencias_caducidad (
  boleto_id, sorteo_id, codigo_error, mensaje, primera_incidencia_en, registrado_en, reintentar_desde
)
select id, '92000000-0000-4000-8000-000000000001', 'P1003', 'Incidencia tardía',
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 hour'
from casos where nombre = 'huerfano';
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where id = (select id from casos where nombre = 'legitimo');
alter table public.boletos enable trigger trg_registrar_revision_boleto;
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 0::bigint,
  'La vista ignora incidencias tardías de boletos ya revisados');
select is(public.caducar_boletos_pendientes(), 0, 'La inconsistencia real sigue protegida tras validar');
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), 0::bigint, 'El job limpia la incidencia tardía');
select is((select codigo_error from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'legitimo')), 'P1003',
  'El job reevalúa la edición inmediatamente y detecta el desajuste todavía existente');

-- Simula conciliación administrativa; la API nunca escribe el contador.
update public.sorteos set tickets_vendidos = 20 where edicion_numero = 900001;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'legitimo');
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'legitimo')), 0::bigint, 'El rechazo manual exitoso también resuelve la incidencia');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900001), 10,
  'Solo libera la reserva rechazada después de conciliar');
reset role;
select ok(not has_function_privilege('authenticated', 'public.resolver_incidencia_caducidad()', 'EXECUTE'),
  'La limpieza privilegiada no se expone como RPC');
select ok(not has_function_privilege('service_role', 'public.liberar_tickets_rechazados()', 'EXECUTE'),
  'El liberador sigue reservado al trigger');
select * from finish();
rollback;
