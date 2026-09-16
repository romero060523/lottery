begin;

-- Supabase habilita pg_cron por Dashboard; validar antes de cualquier DDL.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'Falta pg_cron: habilítalo en Dashboard > Integrations > Cron antes de aplicar las migraciones de caducidad'
      using errcode = '55000', hint = 'La migración no instala extensiones. Consulta supabase/README.md y vuelve a ejecutarla después de habilitar Cron.';
  end if;

  if not has_schema_privilege(current_user, 'cron', 'USAGE')
    or not has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    raise exception 'El rol de migraciones necesita USAGE sobre cron y EXECUTE sobre cron.schedule'
      using errcode = '42501';
  end if;
end;
$$;

alter table public.sorteos
  add column ttl_pendientes_horas integer not null default 24
    check (ttl_pendientes_horas between 1 and 168);

grant insert (ttl_pendientes_horas), update (ttl_pendientes_horas)
  on public.sorteos to authenticated;

alter table public.boletos
  add column motivo_rechazo text,
  add column pendiente_desde timestamptz,
  add column motivo_corregido_por uuid references public.admins(user_id),
  add column motivo_corregido_en timestamptz;

update public.boletos
set motivo_rechazo = case
  when estado = 'rechazado' and validado_por like 'admin:%' then 'manual'
  when estado = 'rechazado' then 'servicio'
end,
pendiente_desde = case when estado = 'pendiente' then statement_timestamp() end
where estado in ('pendiente', 'rechazado');

alter table public.boletos
  add constraint boletos_motivo_rechazo_consistente check (
    (estado = 'rechazado' and motivo_rechazo is not null
      and motivo_rechazo in ('manual', 'caducidad', 'servicio'))
    or (estado <> 'rechazado' and motivo_rechazo is null)
  ),
  add constraint boletos_inicio_pendiente_consistente check (
    (estado = 'pendiente' and pendiente_desde is not null)
    or (estado <> 'pendiente' and pendiente_desde is null)
  ),
  add constraint boletos_correccion_motivo_consistente check (
    (motivo_corregido_por is null and motivo_corregido_en is null)
    or (estado = 'rechazado' and motivo_corregido_por is not null and motivo_corregido_en is not null)
  );

-- Toda alta, también desde una Edge Function, debe reservar mediante comprar_tickets.
-- Cerrar además las mutaciones de cantidades/sorteo y los borrados evita desajustes.
revoke all on public.boletos from service_role;
grant select, update (estado, validado_por, validado_en, metodo_pago, comprobante_url)
  on public.boletos to service_role;
grant update (motivo_rechazo) on public.boletos to authenticated;

create index idx_boletos_pendientes_caducidad
  on public.boletos(sorteo_id, pendiente_desde, id)
  where estado = 'pendiente';

create table public.incidencias_caducidad (
  -- Sin FK: registrar contención no debe volver a bloquear el boleto o el sorteo.
  boleto_id uuid primary key,
  sorteo_id uuid not null,
  codigo_error text not null,
  mensaje text not null,
  intentos integer not null default 1,
  registrado_en timestamptz not null,
  reintentar_desde timestamptz not null
);

create index idx_incidencias_caducidad_sorteo on public.incidencias_caducidad(sorteo_id, reintentar_desde);
alter table public.incidencias_caducidad enable row level security;
revoke all on public.incidencias_caducidad from public, anon, authenticated, service_role;
grant select on public.incidencias_caducidad to authenticated;
create policy incidencias_caducidad_select_admin on public.incidencias_caducidad
  for select to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())));

create or replace function public.registrar_revision_boleto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin uuid;
  v_instante timestamptz := statement_timestamp();
begin
  if tg_op = 'INSERT' then
    new.pendiente_desde := case when new.estado = 'pendiente' then v_instante end;
    new.motivo_rechazo := case
      when new.estado = 'rechazado' and new.validado_por like 'admin:%' then 'manual'
      when new.estado = 'rechazado' then 'servicio'
    end;
    new.motivo_corregido_por := null;
    new.motivo_corregido_en := null;
    return new;
  end if;

  select user_id into v_admin from public.admins where user_id = (select auth.uid());

  new.motivo_corregido_por := old.motivo_corregido_por;
  new.motivo_corregido_en := old.motivo_corregido_en;

  if new.estado is not distinct from old.estado then
    new.pendiente_desde := old.pendiente_desde;
    new.validado_por := old.validado_por;
    new.validado_en := old.validado_en;

    if new.motivo_rechazo is distinct from old.motivo_rechazo then
      if old.estado <> 'rechazado' or v_admin is null then
        raise exception 'Solo un administrador puede corregir el motivo de un boleto rechazado'
          using errcode = '42501';
      end if;

      new.motivo_corregido_por := v_admin;
      new.motivo_corregido_en := v_instante;
    end if;

    return new;
  end if;

  if old.estado = 'rechazado' then
    if old.validado_por = 'sistema:caducidad' then
      raise exception 'El boleto caducó durante la revisión; recarga sus datos. No puede reactivarse'
        using errcode = 'P1002';
    end if;

    raise exception 'Un boleto rechazado no puede reactivarse; debe realizarse una nueva compra';
  end if;

  if new.estado = 'pendiente' then
    new.pendiente_desde := v_instante;
    new.validado_por := null;
    new.validado_en := null;
    new.motivo_rechazo := null;
    return new;
  end if;

  new.pendiente_desde := null;

  if v_admin is not null then
    new.validado_por := 'admin:' || v_admin::text;
  elsif new.validado_por is null or char_length(btrim(new.validado_por)) = 0
    or new.validado_por is not distinct from old.validado_por then
    raise exception 'La revisión de servicio debe identificar al responsable';
  end if;

  new.motivo_rechazo := null;

  if new.estado = 'rechazado' then
    if v_admin is not null then
      new.motivo_rechazo := 'manual';
    elsif new.validado_por = 'sistema:caducidad' then
      if old.estado <> 'pendiente' then
        raise exception 'Solo pueden caducar boletos pendientes' using errcode = '22023';
      end if;

      new.motivo_rechazo := 'caducidad';
    else
      new.motivo_rechazo := 'servicio';
    end if;
  end if;

  new.validado_en := v_instante;
  return new;
end;
$$;

drop trigger trg_registrar_revision_boleto on public.boletos;
create trigger trg_registrar_revision_boleto
  before insert or update on public.boletos
  for each row execute function public.registrar_revision_boleto();

create function public.caducar_boletos_pendientes()
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

  for v_sorteo in
    select sorteos.id, sorteos.ttl_pendientes_horas
    from public.sorteos
    where exists (
      select 1 from public.boletos
      where boletos.sorteo_id = sorteos.id and boletos.estado = 'pendiente'
        and boletos.pendiente_desde < v_instante - make_interval(hours => sorteos.ttl_pendientes_horas)
    )
      and not exists (
        select 1 from public.incidencias_caducidad
        where sorteo_id = sorteos.id and reintentar_desde > v_instante
          and codigo_error in ('55P03', 'P1003')
      )
    order by sorteos.id
  loop
    v_comprobado := false;

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
        -- El lock pertenece al bloque: una excepción también lo libera.
        select pendiente_desde into v_pendiente_desde
        from public.boletos
        where id = v_candidato.id and estado = 'pendiente'
        for update skip locked;

        if not found then
          continue;
        end if;

        -- Las filas bloqueadas no agotan el presupuesto de otros sorteos.
        v_intentos := v_intentos + 1;

        select ttl_pendientes_horas, tickets_vendidos into v_ttl, v_contador
        from public.sorteos where id = v_sorteo.id
        for no key update nowait;

        if v_pendiente_desde >= v_instante - make_interval(hours => v_ttl) then
          continue;
        end if;

        if not v_comprobado then
          -- Comprobación histórica una vez por sorteo, con su contador bloqueado.
          -- No se puede atribuir una reserva a un INSERT antiguo fuera de la RPC.
          select coalesce(sum(cantidad_total), 0) into v_reservas
          from public.boletos
          where sorteo_id = v_sorteo.id and estado <> 'rechazado';

          if v_contador <> v_reservas then
            raise exception 'El contador del sorteo no coincide con sus boletos reservados; requiere conciliación'
              using errcode = 'P1003';
          end if;

          v_comprobado := true;
        end if;

        update public.boletos
        set estado = 'rechazado', validado_por = 'sistema:caducidad'
        where id = v_candidato.id and estado = 'pendiente';

        delete from public.incidencias_caducidad where boleto_id = v_candidato.id;
        v_caducados := v_caducados + 1;
      exception when others then
        get stacked diagnostics v_codigo_error = returned_sqlstate, v_mensaje = message_text;
        -- Las variables PL/pgSQL no retroceden al abortar el subbloque.
        v_comprobado := false;

        insert into public.incidencias_caducidad (
          boleto_id, sorteo_id, codigo_error, mensaje, registrado_en, reintentar_desde
        ) values (
          v_candidato.id, v_sorteo.id, v_codigo_error, v_mensaje, v_instante,
          v_instante + case when v_codigo_error = '55P03' then interval '10 minutes' else interval '1 hour' end
        ) on conflict (boleto_id) do update set
          codigo_error = excluded.codigo_error,
          mensaje = excluded.mensaje,
          registrado_en = excluded.registrado_en,
          reintentar_desde = excluded.reintentar_desde,
          intentos = public.incidencias_caducidad.intentos + 1;

        if v_codigo_error in ('55P03', 'P1003') then
          exit;
        end if;
      end;
    end loop;
  end loop;

  return v_caducados;
end;
$$;

revoke all on function public.registrar_revision_boleto(), public.caducar_boletos_pendientes()
  from public, anon, authenticated, service_role;

commit;
