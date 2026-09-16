begin;

create function public.calcular_tickets_gratis(cantidad integer)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if cantidad is null or cantidad <= 0 then
    raise exception 'La cantidad comprada debe ser un entero positivo' using errcode = '22023';
  end if;

  return cantidad / 4;
end;
$$;

create function public.calcular_monto_total(p_cantidad integer, p_precio_boleto integer)
returns table(cantidad_comprada integer, tickets_gratis integer, cantidad_total integer, monto_total integer)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_gratis integer;
  v_total bigint;
  v_monto bigint;
begin
  if p_precio_boleto is null or p_precio_boleto <= 0 then
    raise exception 'El precio del boleto debe ser un entero positivo en COP' using errcode = '22023';
  end if;

  if p_cantidad = 0 then
    return query select 0, 0, 0, 0;
    return;
  end if;

  v_gratis := public.calcular_tickets_gratis(p_cantidad);
  v_total := p_cantidad::bigint + v_gratis;
  v_monto := p_cantidad::bigint * p_precio_boleto;

  if v_total > 2147483647 or v_monto > 2147483647 then
    raise exception 'La cantidad o el monto excede el límite admitido' using errcode = '22003';
  end if;

  return query select p_cantidad, v_gratis, v_total::integer, v_monto::integer;
end;
$$;

create function public.generar_codigo_boleto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prefijo text;
  v_secuencia text;
begin
  select codigo_prefijo into strict v_prefijo
  from public.sorteos where id = new.sorteo_id;

  v_secuencia := nextval('public.boletos_codigo_seq'::regclass)::text;
  new.codigo := v_prefijo || '-' || lpad(v_secuencia, greatest(5, char_length(v_secuencia)), '0');
  return new;
end;
$$;

create trigger trg_generar_codigo_boleto
  before insert on public.boletos
  for each row execute function public.generar_codigo_boleto();

create function public.registrar_auditoria()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  if tg_op = 'UPDATE' then
    new.creado_por := old.creado_por;

    -- Reservar o liberar tickets no modifica la autoría de la configuración.
    if tg_table_name = 'sorteos'
      and (to_jsonb(new) - array['tickets_vendidos', 'creado_por', 'actualizado_por'])
        = (to_jsonb(old) - array['tickets_vendidos', 'creado_por', 'actualizado_por']) then
      new.actualizado_por := old.actualizado_por;
      return new;
    end if;
  end if;

  select user_id into v_admin from public.admins where user_id = (select auth.uid());

  if tg_op = 'INSERT' then
    new.creado_por := v_admin;
  end if;

  new.actualizado_por := v_admin;
  return new;
end;
$$;

create trigger trg_auditoria_sorteos
  before insert or update on public.sorteos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_sorteo_premios
  before insert or update on public.sorteo_premios
  for each row execute function public.registrar_auditoria();

-- SECURITY DEFINER permite comprar con anon sin conceder escritura directa ni
-- lectura de boletos. Antes de escribir valida identidad de contacto no vacía y
-- acotada, tipo de documento, cantidad positiva, rango de enteros, sorteo activo,
-- fechas de venta, tope de compra y cupo (incluidos los gratis).
-- No verifica la identidad personal.
-- El precio proviene de sorteos; el cliente no elige precio, código ni estado.
-- Solo devuelve el boleto recién insertado. No hay SQL dinámico; search_path está
-- vacío y las relaciones están calificadas. EXECUTE se concede explícitamente.
create function public.comprar_tickets(
  p_sorteo_id uuid,
  p_cantidad integer,
  p_nombre_comprador text,
  p_telefono text,
  p_tipo_documento text,
  p_numero_documento text
)
returns public.boletos
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
    where id = p_sorteo_id
      and activo = true
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
    p_sorteo_id, btrim(p_nombre_comprador), btrim(p_telefono), p_tipo_documento, btrim(p_numero_documento),
    p_cantidad, v_gratis, (p_cantidad::bigint * v_precio)::integer
  ) returning * into v_boleto;

  return v_boleto;
end;
$$;

create function public.registrar_revision_boleto()
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
    return new;
  end if;

  if old.estado = 'rechazado' then
    raise exception 'Un boleto rechazado no puede reactivarse; debe realizarse una nueva compra';
  end if;

  if new.estado = 'pendiente' then
    new.validado_por := null;
    new.validado_en := null;
    return new;
  end if;

  select user_id into v_admin from public.admins where user_id = (select auth.uid());

  if v_admin is not null then
    new.validado_por := 'admin:' || v_admin::text;
  elsif new.validado_por is null or char_length(btrim(new.validado_por)) = 0
    or new.validado_por is not distinct from old.validado_por then
    raise exception 'La revisión de servicio debe identificar al responsable';
  end if;

  new.validado_en := now();
  return new;
end;
$$;

create trigger trg_registrar_revision_boleto
  before update on public.boletos
  for each row execute function public.registrar_revision_boleto();

-- Solo el trigger usa estos privilegios para actualizar el contador protegido.
-- El navegador no puede ejecutar esta función ni cambiar cantidades de boletos.
create function public.liberar_tickets_rechazados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'rechazado' and old.estado <> 'rechazado' then
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

create trigger trg_liberar_tickets_rechazados
  after update of estado on public.boletos
  for each row execute function public.liberar_tickets_rechazados();

revoke all on function public.calcular_tickets_gratis(integer),
  public.calcular_monto_total(integer, integer), public.generar_codigo_boleto(),
  public.registrar_auditoria(), public.comprar_tickets(uuid, integer, text, text, text, text),
  public.registrar_revision_boleto(), public.liberar_tickets_rechazados()
  from public, anon, authenticated, service_role;

commit;
