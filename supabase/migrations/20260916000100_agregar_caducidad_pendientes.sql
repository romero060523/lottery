begin;

alter table public.sorteos
  add column ttl_pendientes_horas integer not null default 24
    check (ttl_pendientes_horas > 0);

grant insert (ttl_pendientes_horas), update (ttl_pendientes_horas)
  on public.sorteos to authenticated;

alter table public.boletos add column motivo_rechazo text;

update public.boletos
set motivo_rechazo = case
  when validado_por like 'admin:%' then 'manual'
  else 'servicio'
end
where estado = 'rechazado';

alter table public.boletos
  add constraint boletos_motivo_rechazo_consistente check (
    (estado = 'rechazado' and motivo_rechazo is not null
      and motivo_rechazo in ('manual', 'caducidad', 'servicio'))
    or (estado <> 'rechazado' and motivo_rechazo is null)
  );

create index idx_boletos_pendientes_caducidad
  on public.boletos(created_at, id)
  where estado = 'pendiente';

create or replace function public.registrar_revision_boleto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  if new.estado is not distinct from old.estado then
    new.validado_por := old.validado_por;
    new.validado_en := old.validado_en;
    new.motivo_rechazo := old.motivo_rechazo;
    return new;
  end if;

  if old.estado = 'rechazado' then
    if old.motivo_rechazo = 'caducidad' then
      raise exception 'El boleto caducó durante la revisión; recarga sus datos. No puede reactivarse'
        using errcode = 'P1002';
    end if;

    raise exception 'Un boleto rechazado no puede reactivarse; debe realizarse una nueva compra';
  end if;

  if new.estado = 'pendiente' then
    new.validado_por := null;
    new.validado_en := null;
    new.motivo_rechazo := null;
    return new;
  end if;

  select user_id into v_admin from public.admins where user_id = (select auth.uid());

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

  new.validado_en := now();
  return new;
end;
$$;

create function public.caducar_boletos_pendientes()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_instante timestamptz := statement_timestamp();
  v_caducados integer;
begin
  with pendientes_vencidos as materialized (
    select boletos.id
    from public.boletos
    join public.sorteos on sorteos.id = boletos.sorteo_id
    where boletos.estado = 'pendiente'
      and v_instante - boletos.created_at > make_interval(hours => sorteos.ttl_pendientes_horas)
    order by boletos.created_at, boletos.id
    limit 1000
    for update of boletos skip locked
  )
  update public.boletos
  set estado = 'rechazado', validado_por = 'sistema:caducidad'
  from pendientes_vencidos
  where boletos.id = pendientes_vencidos.id
    and boletos.estado = 'pendiente';

  get diagnostics v_caducados = row_count;
  return v_caducados;
end;
$$;

revoke all on function public.registrar_revision_boleto(), public.caducar_boletos_pendientes()
  from public, anon, authenticated, service_role;

commit;
