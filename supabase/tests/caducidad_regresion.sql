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
update public.sorteos set activo = false where edicion_numero = 900001;
set local role anon;
select is(public.sorteo_en_cuarentena('92000000-0000-4000-8000-000000000001'), false,
  'El booleano público no informa cuarentenas de ediciones inactivas');
reset role;
update public.sorteos set activo = true where edicion_numero = 900001;

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

-- B2: un fallo de lock puede reemplazar el diagnóstico del boleto, pero no la
-- pausa persistente de la edición.
create temporary table primera_deteccion as
select cuarentena_desde, verificaciones from public.cuarentenas_sorteo
where sorteo_id = '92000000-0000-4000-8000-000000000001';
update public.incidencias_caducidad
set codigo_error = '55P03', mensaje = 'Lock transitorio posterior',
  registrado_en = statement_timestamp(), reintentar_desde = statement_timestamp() + interval '10 minutes'
where boleto_id = (select id from casos where nombre = 'huerfano');
select is((select codigo_error from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'huerfano')), '55P03',
  'B2: la incidencia por boleto puede degradarse a 55P03');
set local role anon;
select is(public.sorteo_en_cuarentena('92000000-0000-4000-8000-000000000001'), true,
  'B2: 55P03 no borra la pausa P1003 de la edición');
select throws_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000001', 1,
    'Compra tras lock', '10', 'cedula', '10')$$,
  'P1004', 'La venta de esta edición está pausada mientras se concilian sus reservas',
  'B2: la venta sigue bloqueada tras el error de contención');
reset role;
update public.incidencias_caducidad set reintentar_desde = statement_timestamp() - interval '1 second';
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 1::bigint,
  'La cuarentena sigue visible aunque ya sea elegible para reintento');
select is(public.caducar_boletos_pendientes(), 0, 'Un reintento fallido conserva el contador');
select is((select cuarentena_desde from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000001'), (select cuarentena_desde from primera_deteccion),
  'Los reintentos conservan desde cuándo está pausada la edición');
select is((select verificaciones from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000001'),
  (select verificaciones + 1 from primera_deteccion), 'Los reintentos registran otra verificación');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.ediciones_en_cuarentena), 0::bigint,
  'Un usuario autenticado sin admin no ve cuarentenas');
select throws_ok(
  $$select public.conciliar_contador_sorteo('92000000-0000-4000-8000-000000000001')$$,
  '42501', 'Solo un administrador puede conciliar el contador de una edición',
  'Un usuario común no puede conciliar');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.ediciones_en_cuarentena where edicion_numero = 900001), 1::bigint,
  'El admin ve la edición en cuarentena');
select ok((select cuarentena_desde is not null and ultimo_fallo_en >= cuarentena_desde
  and motivos->0->>'codigo_error' = 'P1003' and motivos->0->>'mensaje' like '%conciliación%'
  from public.ediciones_en_cuarentena where edicion_numero = 900001),
  'La vista expone fecha, código y motivo consultables por el panel');
select throws_ok($$delete from public.incidencias_caducidad$$, '42501',
  'permission denied for table incidencias_caducidad', 'El admin no borra incidencias directamente');
select throws_ok($$delete from public.cuarentenas_sorteo$$, '42501',
  'permission denied for table cuarentenas_sorteo', 'El admin no levanta la pausa directamente');
reset role;
set local role anon;
select throws_ok($$select * from public.ediciones_en_cuarentena$$, '42501',
  'permission denied for view ediciones_en_cuarentena', 'Anon no accede a la vista');
reset role;

-- B1: revisar el boleto marcado no puede eliminar la pausa. El orden exigido es
-- conciliar la edición y después validar sus boletos.
set local role authenticated;
select throws_ok(
  $$update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'huerfano')$$,
  'P1006', 'Concilia el contador de la edición antes de validar sus boletos',
  'B1: validar antes de conciliar está bloqueado');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select estado from public.boletos where id = (select id from casos where nombre = 'huerfano')),
  'pendiente', 'B1: la validación bloqueada conserva el boleto pendiente');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000001'), 1::bigint,
  'B1: la validación bloqueada conserva la pausa por edición');
set local role anon;
select throws_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000001', 1,
    'Compra tras validación', '11', 'cedula', '11')$$,
  'P1004', 'La venta de esta edición está pausada mientras se concilian sus reservas',
  'B1: la venta no se reabre al intentar validar el boleto marcado');
reset role;

-- La única salida pública de administración recalcula, audita y levanta la pausa
-- en una sola transacción. Después pueden revisarse los boletos.
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.conciliar_contador_sorteo('92000000-0000-4000-8000-000000000001')$$,
  'El admin puede conciliar por RPC');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900001), 20,
  'La conciliación iguala el contador con las reservas reales');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000001'), 0::bigint,
  'La conciliación verificada levanta la pausa');
select is((select count(*) from public.incidencias_caducidad where sorteo_id =
  '92000000-0000-4000-8000-000000000001' and codigo_error = 'P1003'), 0::bigint,
  'La conciliación limpia los diagnósticos P1003');
select ok((select tickets_vendidos_anterior = 10 and tickets_vendidos_conciliado = 20
    and conciliado_por = '91000000-0000-4000-8000-000000000001' and conciliado_en is not null
  from public.conciliaciones_sorteo where sorteo_id = '92000000-0000-4000-8000-000000000001'),
  'La conciliación registra contador anterior, nuevo, admin y fecha');
select lives_ok(
  $$update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'huerfano')$$,
  'Después de conciliar el admin puede validar');
update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'legitimo');
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'legitimo')), 0::bigint, 'El rechazo manual exitoso también resuelve la incidencia');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900001), 10,
  'Solo libera la reserva rechazada después de conciliar');
reset role;

-- El job también puede levantar una pausa, pero solo después de comprobar que
-- una reparación previa dejó contador y reservas iguales.
insert into public.sorteos (id, edicion_numero, nombre, precio_boleto, tickets_totales)
values ('92000000-0000-4000-8000-000000000004', 900004, 'Verificación del job', 5000, 100);
insert into casos
select 'job_legitimo', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000004', 1, 'Job legítimo', '12', 'cedula', '12');
with boleto as (
  insert into public.boletos (
    sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
    cantidad_comprada, cantidad_gratis, monto_total
  ) values (
    '92000000-0000-4000-8000-000000000004', 'Job huérfano', '13', 'cedula', '13', 1, 0, 5000
  ) returning id
)
insert into casos select 'job_huerfano', id from boleto;
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where id = (select id from casos where nombre = 'job_huerfano');
alter table public.boletos enable trigger trg_registrar_revision_boleto;
select is(public.caducar_boletos_pendientes(), 0,
  'El job pausa una edición cuyo contador todavía no cuadra');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000004'), 1::bigint,
  'La pausa del job queda persistida por edición');
update public.sorteos set tickets_vendidos = 2 where edicion_numero = 900004;
update public.incidencias_caducidad set reintentar_desde = statement_timestamp() - interval '1 second'
where boleto_id = (select id from casos where nombre = 'job_huerfano');
select is(public.caducar_boletos_pendientes(), 1,
  'El job levanta la pausa solo después de verificar igualdad');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000004'), 0::bigint,
  'La verificación consistente del job elimina la pausa');
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900004), 1,
  'Tras verificar, el job libera solo la reserva caducada');

-- Salida por API de una edición sobrevendida: con reservas por encima de la
-- capacidad la conciliación no puede ajustar el contador. Durante la pausa se
-- rechaza sin descontar (la conciliación recalcula) y validar sigue bloqueado.
insert into public.sorteos (id, edicion_numero, nombre, precio_boleto, tickets_totales)
values ('92000000-0000-4000-8000-000000000005', 900005, 'Sobrevendida', 5000, 20);
insert into casos
select 'sobre_legitimo', id from public.comprar_tickets(
  '92000000-0000-4000-8000-000000000005', 16, 'Sobre legítimo', '14', 'cedula', '14');
with boleto as (
  insert into public.boletos (
    sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
    cantidad_comprada, cantidad_gratis, monto_total
  ) values (
    '92000000-0000-4000-8000-000000000005', 'Sobre huérfano', '15', 'cedula', '15', 8, 2, 40000
  ) returning id
)
insert into casos select 'sobre_huerfano', id from boleto;
alter table public.boletos disable trigger trg_registrar_revision_boleto;
update public.boletos set pendiente_desde = statement_timestamp() - interval '25 hours'
where id = (select id from casos where nombre = 'sobre_huerfano');
alter table public.boletos enable trigger trg_registrar_revision_boleto;
select is(public.caducar_boletos_pendientes(), 0, 'El job pausa la edición sobrevendida');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.conciliar_contador_sorteo('92000000-0000-4000-8000-000000000005')$$,
  'P1005', 'Las reservas verificadas (30) superan la capacidad de la edición (20); rechaza reservas hasta que quepan y vuelve a conciliar',
  'Con reservas sobre la capacidad la conciliación no cambia nada');
select throws_ok(
  $$update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'sobre_legitimo')$$,
  'P1006', 'Concilia el contador de la edición antes de validar sus boletos',
  'Durante la pausa tampoco se valida la reserva legítima');
select lives_ok(
  $$update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'sobre_huerfano')$$,
  'Durante la pausa el admin puede rechazar para bajar las reservas');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select tickets_vendidos from public.sorteos where edicion_numero = 900005), 20,
  'El rechazo durante la pausa no descuenta el contador no confiable');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000005'), 1::bigint,
  'B1: rechazar el boleto marcado no levanta la pausa');
select is((select codigo_error from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'sobre_huerfano')), 'P1003',
  'El diagnóstico P1003 del boleto rechazado se conserva como evidencia');
select is(public.caducar_boletos_pendientes(), 0,
  'Sin pendientes vencidos el job no verifica la edición');
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000005'), 1::bigint,
  'B1: un job que no pudo verificar igualdad no levanta la pausa');
set local role anon;
select throws_ok(
  $$select public.comprar_tickets('92000000-0000-4000-8000-000000000005', 1,
    'Compra tras rechazo', '16', 'cedula', '16')$$,
  'P1004', 'La venta de esta edición está pausada mientras se concilian sus reservas',
  'B1: la venta sigue pausada tras revisar el boleto marcado');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.conciliar_contador_sorteo('92000000-0000-4000-8000-000000000005')$$,
  'Con las reservas dentro de la capacidad la conciliación procede');
select ok((select tickets_vendidos_anterior = 20 and tickets_vendidos_conciliado = 20
  from public.conciliaciones_sorteo where sorteo_id = '92000000-0000-4000-8000-000000000005'),
  'La auditoría registra la conciliación de la edición sobrevendida');
select lives_ok(
  $$update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'sobre_legitimo')$$,
  'Tras conciliar se valida la reserva legítima');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*) from public.cuarentenas_sorteo where sorteo_id =
  '92000000-0000-4000-8000-000000000005'), 0::bigint,
  'La conciliación levanta la pausa de la edición sobrevendida');
select is((select count(*) from public.incidencias_caducidad where sorteo_id =
  '92000000-0000-4000-8000-000000000005'), 0::bigint,
  'La conciliación limpia la evidencia P1003 del boleto rechazado');

-- Sin pausa, la guarda y la resolución de incidencias conservan su contrato.
insert into public.sorteos (id, edicion_numero, nombre, precio_boleto, tickets_totales)
values ('92000000-0000-4000-8000-000000000006', 900006, 'Inconsistente sin pausa', 5000, 100);
select comprar_tickets('92000000-0000-4000-8000-000000000006', 4, 'Sin pausa', '17', 'cedula', '17');
with boleto as (
  insert into public.boletos (
    sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
    cantidad_comprada, cantidad_gratis, monto_total, estado, validado_por, validado_en
  ) values (
    '92000000-0000-4000-8000-000000000006', 'Validado sin reserva', '18', 'cedula', '18', 4, 1, 20000,
    'validado', 'admin:91000000-0000-4000-8000-000000000001', statement_timestamp()
  ) returning id
)
insert into casos select 'validado_sin_reserva', id from boleto;
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update public.boletos set estado = 'rechazado' where id = (select id from casos where nombre = 'validado_sin_reserva')$$,
  'P1003', 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación',
  'M1: sin pausa, validado a rechazado también exige contador consistente');
update public.boletos set estado = 'validado' where id = (select id from casos where nombre = 'contencion');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'contencion')), 0::bigint,
  'Revisar un boleto sin pausa resuelve su incidencia 55P03');
insert into public.incidencias_caducidad (
  boleto_id, sorteo_id, codigo_error, mensaje, primera_incidencia_en, registrado_en, reintentar_desde
)
select id, '92000000-0000-4000-8000-000000000002', '55P03', 'Incidencia tardía',
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '10 minutes'
from casos where nombre = 'multiple_1';
select is(public.caducar_boletos_pendientes(), 0, 'El job corre sin pendientes vencidos');
select is((select count(*) from public.incidencias_caducidad where boleto_id =
  (select id from casos where nombre = 'multiple_1')), 0::bigint,
  'El job limpia incidencias tardías de boletos ya revisados');

select ok(not has_function_privilege('authenticated', 'public.resolver_incidencia_caducidad()', 'EXECUTE'),
  'La limpieza privilegiada no se expone como RPC');
select ok(not has_function_privilege('anon', 'public.conciliar_contador_sorteo(uuid)', 'EXECUTE'),
  'Anon no puede conciliar');
select ok(not has_function_privilege('service_role', 'public.conciliar_contador_sorteo(uuid)', 'EXECUTE'),
  'Service role no salta la conciliación auditada del admin');
select ok(not has_function_privilege('service_role', 'public.liberar_tickets_rechazados()', 'EXECUTE'),
  'El liberador sigue reservado al trigger');
select * from finish();
rollback;
