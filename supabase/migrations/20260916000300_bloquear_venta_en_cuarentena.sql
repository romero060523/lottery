begin;

-- Superficie pública mínima: informa solo si P1003 mantiene la edición en
-- cuarentena. No expone boletos, causas, intentos ni fechas operativas.
create function public.sorteo_en_cuarentena(p_sorteo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.incidencias_caducidad i
    join public.boletos b on b.id = i.boleto_id and b.sorteo_id = i.sorteo_id
    where i.sorteo_id = p_sorteo_id
      and i.codigo_error = 'P1003'
      and b.estado = 'pendiente'
  );
$$;

revoke all on function public.sorteo_en_cuarentena(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sorteo_en_cuarentena(uuid)
  to anon, authenticated, service_role;

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

  -- Serializa la comprobación de cuarentena con las reservas de esta edición.
  -- La incidencia puede consultarse después de obtener el lock con una sentencia
  -- nueva, de modo que una compra que esperaba vea el P1003 ya confirmado.
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
