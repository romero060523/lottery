begin;

-- La pausa pertenece a la edición. Las incidencias por boleto siguen siendo
-- diagnóstico/reintento y pueden cambiar sin reabrir la venta.
create table public.cuarentenas_sorteo (
  sorteo_id uuid primary key references public.sorteos(id) on delete cascade,
  codigo_error text not null default 'P1003' check (codigo_error = 'P1003'),
  mensaje text not null,
  cuarentena_desde timestamptz not null,
  ultima_verificacion_en timestamptz not null,
  verificaciones integer not null default 1 check (verificaciones > 0)
);

create table public.conciliaciones_sorteo (
  id bigint generated always as identity primary key,
  sorteo_id uuid not null references public.sorteos(id),
  tickets_vendidos_anterior integer not null,
  tickets_vendidos_conciliado integer not null,
  conciliado_por uuid not null references public.admins(user_id),
  conciliado_en timestamptz not null
);

alter table public.cuarentenas_sorteo enable row level security;
alter table public.conciliaciones_sorteo enable row level security;
revoke all on public.cuarentenas_sorteo, public.conciliaciones_sorteo
  from public, anon, authenticated, service_role;
grant select on public.cuarentenas_sorteo, public.conciliaciones_sorteo to authenticated;

create policy cuarentenas_sorteo_select_admin on public.cuarentenas_sorteo
  for select to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())));
create policy conciliaciones_sorteo_select_admin on public.conciliaciones_sorteo
  for select to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())));

-- Conserva el contrato de columnas de la vista, pero la fila y su motivo salen
-- del estado persistente de la edición, no del último error de un boleto.
create or replace view public.ediciones_en_cuarentena
with (security_invoker = true) as
select s.id as sorteo_id, s.edicion_numero, s.nombre,
  q.cuarentena_desde,
  q.ultima_verificacion_en as ultimo_fallo_en,
  null::timestamptz as reintentar_desde,
  jsonb_build_array(jsonb_build_object(
    'boleto_id', null,
    'codigo_error', q.codigo_error,
    'mensaje', q.mensaje,
    'desde', q.cuarentena_desde,
    'intentos', q.verificaciones
  )) as motivos
from public.cuarentenas_sorteo q
join public.sorteos s on s.id = q.sorteo_id;

-- Superficie pública mínima: informa solo si una edición activa está pausada.
-- No expone boletos, causas, intentos ni fechas operativas.
create function public.sorteo_en_cuarentena(p_sorteo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cuarentenas_sorteo q
    join public.sorteos s on s.id = q.sorteo_id
    where q.sorteo_id = p_sorteo_id and s.activo = true
  );
$$;

revoke all on function public.sorteo_en_cuarentena(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sorteo_en_cuarentena(uuid)
  to anon, authenticated, service_role;

-- Validar (o devolver a pendiente) antes de conciliar aceptaría una reserva que el
-- contador no reconoce, quizá por encima de la capacidad. Rechazar sí se permite:
-- es la forma de bajar las reservas de una edición sobrevendida antes de conciliar.
create function public.bloquear_validacion_en_cuarentena()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado is distinct from old.estado and new.estado <> 'rechazado' and exists (
    select 1 from public.cuarentenas_sorteo where sorteo_id = old.sorteo_id
  ) then
    raise exception 'Concilia el contador de la edición antes de validar sus boletos'
      using errcode = 'P1006';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_validacion_en_cuarentena
  before update of estado on public.boletos
  for each row execute function public.bloquear_validacion_en_cuarentena();

-- Con la edición en pausa el contador no es confiable: un rechazo no lo descuenta
-- ni aplica la guarda P1003, porque la conciliación (o el job al verificar igualdad)
-- lo recalcula desde las reservas. El lock del sorteo va primero, para que un rechazo
-- concurrente con la conciliación vea la pausa ya levantada y descuente normalmente.
create or replace function public.liberar_tickets_rechazados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contador integer;
  v_reservas bigint;
begin
  if new.estado = 'rechazado' and old.estado <> 'rechazado' then
    select tickets_vendidos into v_contador
    from public.sorteos where id = old.sorteo_id
    for no key update;

    if exists (select 1 from public.cuarentenas_sorteo where sorteo_id = old.sorteo_id) then
      return new;
    end if;

    select coalesce(sum(cantidad_total), 0) into v_reservas
    from public.boletos
    where sorteo_id = old.sorteo_id and estado <> 'rechazado';

    if v_contador is distinct from v_reservas then
      raise exception 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación'
        using errcode = 'P1003';
    end if;

    update public.sorteos
    set tickets_vendidos = tickets_vendidos - old.cantidad_total
    where id = old.sorteo_id and tickets_vendidos >= old.cantidad_total;

    if not found then
      raise exception 'El contador del sorteo no permite liberar los tickets reservados';
    end if;
  end if;
  return new;
end;
$$;

-- Una revisión ya no elimina el diagnóstico P1003 mientras la pausa de la
-- edición siga abierta. La conciliación limpia ambos estados atómicamente.
create or replace function public.resolver_incidencia_caducidad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.incidencias_caducidad i
  where i.boleto_id = new.id
    and not (
      i.codigo_error = 'P1003'
      and exists (
        select 1 from public.cuarentenas_sorteo q where q.sorteo_id = i.sorteo_id
      )
    );
  return new;
end;
$$;

create function public.conciliar_contador_sorteo(p_sorteo_id uuid)
returns public.conciliaciones_sorteo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_contador integer;
  v_capacidad integer;
  v_reservas bigint;
  v_instante timestamptz := statement_timestamp();
  v_auditoria public.conciliaciones_sorteo;
begin
  select user_id into v_admin
  from public.admins
  where user_id = (select auth.uid());

  if v_admin is null then
    raise exception 'Solo un administrador puede conciliar el contador de una edición'
      using errcode = '42501';
  end if;

  select tickets_vendidos, tickets_totales into v_contador, v_capacidad
  from public.sorteos
  where id = p_sorteo_id
  for no key update;

  if not found then
    raise exception 'La edición indicada no existe' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.cuarentenas_sorteo where sorteo_id = p_sorteo_id
  ) then
    raise exception 'La edición indicada no está en cuarentena' using errcode = '22023';
  end if;

  select coalesce(sum(cantidad_total), 0) into v_reservas
  from public.boletos
  where sorteo_id = p_sorteo_id and estado <> 'rechazado';

  if v_reservas > v_capacidad then
    raise exception 'Las reservas verificadas (%) superan la capacidad de la edición (%); rechaza reservas hasta que quepan y vuelve a conciliar',
      v_reservas, v_capacidad
      using errcode = 'P1005';
  end if;

  update public.sorteos
  set tickets_vendidos = v_reservas::integer
  where id = p_sorteo_id;

  insert into public.conciliaciones_sorteo (
    sorteo_id, tickets_vendidos_anterior, tickets_vendidos_conciliado,
    conciliado_por, conciliado_en
  ) values (
    p_sorteo_id, v_contador, v_reservas::integer, v_admin, v_instante
  ) returning * into v_auditoria;

  delete from public.incidencias_caducidad
  where sorteo_id = p_sorteo_id and codigo_error = 'P1003';
  delete from public.cuarentenas_sorteo where sorteo_id = p_sorteo_id;

  return v_auditoria;
end;
$$;

revoke all on function public.conciliar_contador_sorteo(uuid),
  public.bloquear_validacion_en_cuarentena()
  from public, anon, authenticated, service_role;
grant execute on function public.conciliar_contador_sorteo(uuid) to authenticated;

create or replace function public.caducar_boletos_pendientes()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_instante timestamptz := statement_timestamp();
  v_sorteo record;
  v_candidato record;
  v_pendiente_desde timestamptz;
  v_ttl integer;
  v_contador integer;
  v_reservas bigint;
  v_comprobado boolean;
  v_codigo_error text;
  v_mensaje text;
  v_intentos integer := 0;
  v_caducados integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('public.caducar_boletos_pendientes', 0)) then
    return 0;
  end if;

  -- Las incidencias P1003 se conservan como diagnóstico hasta que la edición
  -- sea verificada o conciliada, incluso si su boleto ya fue revisado.
  with resueltas as (
    select i.boleto_id from public.incidencias_caducidad i
    where not exists (
      select 1 from public.boletos b
      where b.id = i.boleto_id and b.sorteo_id = i.sorteo_id and b.estado = 'pendiente'
    )
      and not (
        i.codigo_error = 'P1003'
        and exists (
          select 1 from public.cuarentenas_sorteo q where q.sorteo_id = i.sorteo_id
        )
      )
    for update of i skip locked
  )
  delete from public.incidencias_caducidad i
  using resueltas where i.boleto_id = resueltas.boleto_id;

  for v_sorteo in
    select sorteos.id, sorteos.ttl_pendientes_horas
    from public.sorteos
    where exists (
      select 1 from public.boletos
      where boletos.sorteo_id = sorteos.id and boletos.estado = 'pendiente'
        and boletos.pendiente_desde < v_instante - make_interval(hours => sorteos.ttl_pendientes_horas)
    )
      and not exists (
        select 1 from public.incidencias_caducidad i
        join public.boletos b on b.id = i.boleto_id and b.sorteo_id = i.sorteo_id
        where i.sorteo_id = sorteos.id and i.reintentar_desde > v_instante
          and i.codigo_error in ('55P03', 'P1003') and b.estado = 'pendiente'
      )
    order by sorteos.id
  loop
    v_comprobado := false;

    <<candidatos>>
    for v_candidato in
      select boletos.id
      from public.boletos
      left join public.incidencias_caducidad on boleto_id = boletos.id
      where boletos.sorteo_id = v_sorteo.id and boletos.estado = 'pendiente'
        and boletos.pendiente_desde < v_instante - make_interval(hours => v_sorteo.ttl_pendientes_horas)
        and (reintentar_desde is null or reintentar_desde <= v_instante)
      order by boletos.pendiente_desde, boletos.id
      limit 1000
    loop
      if v_intentos >= 1000 then
        return v_caducados;
      end if;

      begin
        select pendiente_desde into v_pendiente_desde
        from public.boletos
        where id = v_candidato.id and estado = 'pendiente'
        for update skip locked;

        if not found then
          continue;
        end if;

        v_intentos := v_intentos + 1;

        select ttl_pendientes_horas, tickets_vendidos into v_ttl, v_contador
        from public.sorteos where id = v_sorteo.id
        for no key update nowait;

        if v_pendiente_desde >= v_instante - make_interval(hours => v_ttl) then
          continue;
        end if;

        if not v_comprobado then
          select coalesce(sum(cantidad_total), 0) into v_reservas
          from public.boletos
          where sorteo_id = v_sorteo.id and estado <> 'rechazado';

          if v_contador <> v_reservas then
            v_mensaje := 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación';

            insert into public.cuarentenas_sorteo (
              sorteo_id, mensaje, cuarentena_desde, ultima_verificacion_en
            ) values (
              v_sorteo.id, v_mensaje, v_instante, v_instante
            ) on conflict (sorteo_id) do update set
              mensaje = excluded.mensaje,
              ultima_verificacion_en = excluded.ultima_verificacion_en,
              verificaciones = public.cuarentenas_sorteo.verificaciones + 1;

            insert into public.incidencias_caducidad (
              boleto_id, sorteo_id, codigo_error, mensaje, primera_incidencia_en,
              registrado_en, reintentar_desde
            ) values (
              v_candidato.id, v_sorteo.id, 'P1003', v_mensaje, v_instante, v_instante,
              v_instante + interval '1 hour'
            ) on conflict (boleto_id) do update set
              primera_incidencia_en = case
                when public.incidencias_caducidad.codigo_error = excluded.codigo_error
                  then public.incidencias_caducidad.primera_incidencia_en
                else excluded.primera_incidencia_en
              end,
              codigo_error = excluded.codigo_error,
              mensaje = excluded.mensaje,
              registrado_en = excluded.registrado_en,
              reintentar_desde = excluded.reintentar_desde,
              intentos = public.incidencias_caducidad.intentos + 1;

            exit candidatos;
          end if;

          -- Una verificación consistente del job levanta la pausa. Si cualquier
          -- paso posterior falla, el subbloque revierte también esta limpieza.
          delete from public.incidencias_caducidad
          where sorteo_id = v_sorteo.id and codigo_error = 'P1003';
          delete from public.cuarentenas_sorteo where sorteo_id = v_sorteo.id;
          v_comprobado := true;
        end if;

        update public.boletos
        set estado = 'rechazado', validado_por = 'sistema:caducidad'
        where id = v_candidato.id and estado = 'pendiente';

        v_caducados := v_caducados + 1;
      exception when others then
        get stacked diagnostics v_codigo_error = returned_sqlstate, v_mensaje = message_text;
        v_comprobado := false;

        if v_codigo_error = 'P1003' then
          insert into public.cuarentenas_sorteo (
            sorteo_id, mensaje, cuarentena_desde, ultima_verificacion_en
          ) values (
            v_sorteo.id, v_mensaje, v_instante, v_instante
          ) on conflict (sorteo_id) do update set
            mensaje = excluded.mensaje,
            ultima_verificacion_en = excluded.ultima_verificacion_en,
            verificaciones = public.cuarentenas_sorteo.verificaciones + 1;
        end if;

        insert into public.incidencias_caducidad (
          boleto_id, sorteo_id, codigo_error, mensaje, primera_incidencia_en,
          registrado_en, reintentar_desde
        ) values (
          v_candidato.id, v_sorteo.id, v_codigo_error, v_mensaje, v_instante, v_instante,
          v_instante + case when v_codigo_error = '55P03' then interval '10 minutes' else interval '1 hour' end
        ) on conflict (boleto_id) do update set
          primera_incidencia_en = case
            when public.incidencias_caducidad.codigo_error = excluded.codigo_error
              then public.incidencias_caducidad.primera_incidencia_en
            else excluded.primera_incidencia_en
          end,
          codigo_error = excluded.codigo_error,
          mensaje = excluded.mensaje,
          registrado_en = excluded.registrado_en,
          reintentar_desde = excluded.reintentar_desde,
          intentos = public.incidencias_caducidad.intentos + 1;

        if v_codigo_error in ('55P03', 'P1003') then
          exit candidatos;
        end if;
      end;
    end loop candidatos;
  end loop;

  return v_caducados;
end;
$$;

create or replace function public.comprar_tickets(
  p_sorteo_id uuid,
  p_cantidad integer,
  p_nombre_comprador text,
  p_telefono text,
  p_tipo_documento text,
  p_numero_documento text
) returns public.boletos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_precio integer;
  v_gratis integer;
  v_incremento bigint;
  v_max_tickets_por_compra integer;
  v_boleto public.boletos;
begin
  v_gratis := public.calcular_tickets_gratis(p_cantidad);
  v_incremento := p_cantidad::bigint + v_gratis;

  if p_sorteo_id is null or v_incremento > 2147483647 then
    raise exception 'El sorteo o la cantidad solicitada no es válido' using errcode = '22023';
  end if;

  if p_nombre_comprador is null or char_length(btrim(p_nombre_comprador)) not between 1 and 200
    or p_telefono is null or char_length(btrim(p_telefono)) not between 1 and 32
    or p_numero_documento is null or char_length(btrim(p_numero_documento)) not between 1 and 32
    or p_tipo_documento is null or p_tipo_documento not in ('cedula', 'pasaporte') then
    raise exception 'Los datos del comprador están incompletos o exceden la longitud permitida'
      using errcode = '22023';
  end if;

  -- Mantiene estable el contador mientras se consulta la pausa persistente; por MVCC
  -- solo se ven pausas confirmadas. El job escribe la pausa sin soltar este lock (no
  -- pasa por una excepción), así que una compra concurrente con la detección espera su
  -- commit y ve la pausa. Si la compra tomó el lock primero, ese intento del job es 55P03.
  perform 1 from public.sorteos where id = p_sorteo_id for no key update;

  if found and public.sorteo_en_cuarentena(p_sorteo_id) then
    raise exception 'La venta de esta edición está pausada mientras se concilian sus reservas'
      using errcode = 'P1004';
  end if;

  update public.sorteos
  set tickets_vendidos = tickets_vendidos + v_incremento
  where id = p_sorteo_id
    and activo = true
    and fecha_inicio_ventas <= now()
    and (fecha_fin_ventas is null or fecha_fin_ventas > now())
    and p_cantidad <= max_tickets_por_compra
    and v_incremento <= tickets_totales - tickets_vendidos
    and p_cantidad::bigint * precio_boleto <= 2147483647
  returning precio_boleto into v_precio;

  if not found then
    select max_tickets_por_compra into v_max_tickets_por_compra
    from public.sorteos
    where id = p_sorteo_id and activo = true
      and fecha_inicio_ventas <= now()
      and (fecha_fin_ventas is null or fecha_fin_ventas > now());

    if p_cantidad > v_max_tickets_por_compra then
      raise exception 'La cantidad comprada supera el máximo de % tickets por compra', v_max_tickets_por_compra
        using errcode = 'P1001';
    end if;

    raise exception 'No hay cupo, la venta no está habilitada o el monto excede el límite admitido';
  end if;

  insert into public.boletos (
    sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
    cantidad_comprada, cantidad_gratis, monto_total
  ) values (
    p_sorteo_id, btrim(p_nombre_comprador), btrim(p_telefono), p_tipo_documento,
    btrim(p_numero_documento), p_cantidad, v_gratis,
    (p_cantidad::bigint * v_precio)::integer
  ) returning * into v_boleto;

  return v_boleto;
end;
$$;

commit;
