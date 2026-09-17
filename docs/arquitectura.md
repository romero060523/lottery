# Arquitectura — Plataforma de Sorteos (Colombia)

Proyecto nuevo, inspirado en el modelo de negocio de Premios Lorenzo (Perú), adaptado a Colombia. Repo y proyecto Supabase independientes — no se toca el código de Premios Lorenzo.

## 1. Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vite + React 19 + TypeScript + React Router 7 (SPA) |
| Estado global | Zustand (equivalente directo a Pinia: sin boilerplate, un store simple para el sorteo seleccionado) |
| Data fetching | TanStack Query (caché, reintentos y estados de carga sobre las llamadas a Supabase) |
| Formularios | React Hook Form + Zod (valida en el cliente espejando las constraints de Postgres) |
| Estilos | TailwindCSS v4 |
| Backend | Supabase (Postgres, Storage, Edge Functions) — proyecto nuevo |
| Package manager | pnpm |

**Trade-off a tener en cuenta (no bloqueante):** al ser SPA puro, las vistas previas de Open Graph al compartir el link de un sorteo en WhatsApp/redes van a mostrar siempre el mismo `og:image`/`og:title` estático, no algo específico por sorteo. Se puede resolver más adelante con un prerender ligero de la landing si la difusión por WhatsApp resulta clave para el negocio.

**Nota de despliegue:** en Vercel/Netlify hay que configurar un rewrite a `index.html` para que rutas como `/registro` no den 404 al refrescar la página.

**Nota sobre routing:** React Router no tiene `route.meta` nativo como Vue Router. El equivalente al patrón "layout ancho/angosto por ruta" es usar rutas anidadas con un componente de layout por grupo:

```
<Route element={<WideLayout />}>
  <Route path="/" element={<LandingPage />} />
</Route>
<Route element={<NarrowLayout />}>
  <Route path="/registro" element={<RegisterFormPage />} />
  <Route path="/consulta" element={<TicketLookupPage />} />
</Route>
```

## 2. Esquema de base de datos

> El SQL que se aplica vive en `supabase/migrations/` (seis archivos, en orden:
> tablas e índices → funciones y triggers → permisos, RLS y Storage → caducidad de
> pendientes → programación del job con `pg_cron` → bloqueo de venta en cuarentena).
> Lo que sigue refleja el esquema
> **efectivo**: cuando una migración posterior reemplaza una función o un trigger,
> aquí figura la última versión. Si algo diverge, **gana la migración** y hay que
> corregir este documento.

```sql
-- Whitelist de administradores (detalle en la sección 6)
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  created_at timestamptz not null default now()
);

-- Sorteos activos
create table public.sorteos (
  id uuid primary key default gen_random_uuid(),
  edicion_numero integer not null unique check (edicion_numero > 0), -- 01, 02, 03... una fila por edición
  nombre text not null check (char_length(btrim(nombre)) > 0),
  subtitulo text,
  descripcion text,
  banner_url text,
  color_hex text,
  precio_boleto integer not null check (precio_boleto > 0), -- COP, entero, sin decimales (ej. 5000)
  tickets_totales integer not null check (tickets_totales > 0), -- ej. 5000 — barra de progreso "vendidos/restantes"
  max_tickets_por_compra integer not null default 50 check (max_tickets_por_compra > 0), -- tope por llamada a comprar_tickets
  tickets_vendidos integer not null default 0, -- contador denormalizado, se actualiza atómicamente en cada compra (ver sección 8)
  codigo_prefijo text not null default 'PD' check (char_length(btrim(codigo_prefijo)) between 1 and 20),
  fecha_inicio_ventas timestamptz not null default now(),
  fecha_fin_ventas timestamptz,
  activo boolean not null default true,
  creado_por uuid references public.admins(user_id),      -- auditoría; la asigna un trigger, no el cliente
  actualizado_por uuid references public.admins(user_id), -- auditoría; la asigna un trigger, no el cliente
  created_at timestamptz not null default now(),
  -- ttl_pendientes_horas la agrega la migración de caducidad (ver "Caducidad de pendientes")
  constraint sorteos_capacidad_valida check (tickets_vendidos between 0 and tickets_totales),
  -- fecha_sorteo la agrega su propia migración (ver "Fecha del sorteo")
  constraint sorteos_fechas_validas check (fecha_fin_ventas is null or fecha_fin_ventas > fecha_inicio_ventas)
);

-- Premios por sorteo (el diseño distingue un premio mayor de varios secundarios)
create table public.sorteo_premios (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references public.sorteos(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) > 0),
  tipo text not null default 'secundario' check (tipo in ('mayor', 'secundario')),
  badge_label text, -- etiqueta mostrada sobre la foto: "Premio mayor", "Top pick", "Bonus"
  valor_referencial integer check (valor_referencial >= 0), -- COP, ej. 8500000
  imagen_url text,
  orden integer not null default 0 check (orden >= 0),
  creado_por uuid references public.admins(user_id),
  actualizado_por uuid references public.admins(user_id)
);

-- Registros de boletos comprados
create table public.boletos (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references public.sorteos(id),
  codigo text not null unique, -- pase digital, ej. "PD-00001" — lo asigna el trigger, nunca llega null
  nombre_comprador text not null check (char_length(btrim(nombre_comprador)) between 1 and 200),
  telefono text not null check (char_length(btrim(telefono)) between 1 and 32),
  tipo_documento text not null check (tipo_documento in ('cedula', 'pasaporte')),
  numero_documento text not null check (char_length(btrim(numero_documento)) between 1 and 32),
  cantidad_comprada integer not null check (cantidad_comprada > 0),
  cantidad_gratis integer not null default 0 check (cantidad_gratis >= 0),
  cantidad_total integer generated always as (cantidad_comprada + cantidad_gratis) stored,
  monto_total integer not null check (monto_total > 0), -- COP
  metodo_pago text, -- null mientras no se defina la forma de pago; luego 'nequi', etc.
  comprobante_url text, -- null en fase manual, se llena cuando exista upload de comprobante
  estado text not null default 'pendiente' check (estado in ('pendiente', 'validado', 'rechazado')),
  validado_por text, -- 'admin:<user_id>' en revisión manual, 'ocr:nequi' cuando se automatice
  validado_en timestamptz,
  created_at timestamptz not null default now(),
  -- motivo_rechazo, pendiente_desde, motivo_corregido_por y motivo_corregido_en, con sus
  -- constraints, los agrega la migración de caducidad (ver "Caducidad de pendientes")
  -- Un boleto pendiente no tiene revisión; uno revisado siempre dice quién y cuándo
  constraint boletos_revision_consistente check (
    (estado = 'pendiente' and validado_por is null and validado_en is null)
    or (estado in ('validado', 'rechazado') and validado_por is not null
      and char_length(btrim(validado_por)) > 0 and validado_en is not null)
  )
);

-- Hall of fame: ganadores históricos que se muestran en la landing (persisten aunque el sorteo cierre)
create table public.ganadores (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references public.sorteos(id),
  premio_id uuid references public.sorteo_premios(id),
  boleto_id uuid references public.boletos(id),
  nombre_ganador text not null check (char_length(btrim(nombre_ganador)) > 0),
  ciudad text,
  fecha_entrega date,
  foto_url text,
  created_at timestamptz not null default now()
);

create index idx_boletos_sorteo_id on public.boletos(sorteo_id);
create index idx_boletos_estado on public.boletos(estado); -- para AdminBoletosPage
create index idx_boletos_numero_documento on public.boletos(numero_documento); -- todavía sin consumidor, ver pendiente #6
create index idx_sorteo_premios_sorteo_id on public.sorteo_premios(sorteo_id);
create index idx_ganadores_sorteo_id on public.ganadores(sorteo_id);
create index idx_ganadores_premio_id on public.ganadores(premio_id);
create index idx_ganadores_boleto_id on public.ganadores(boleto_id);
-- idx_boletos_pendientes_caducidad, parcial sobre pendientes: ver "Caducidad de pendientes"

-- Las tablas nacen cerradas: RLS activo y permisos revocados. Las políticas se
-- agregan en la tercera migración (sección 6).
alter table public.admins enable row level security;
alter table public.sorteos enable row level security;
alter table public.sorteo_premios enable row level security;
alter table public.boletos enable row level security;
alter table public.ganadores enable row level security;

revoke all on table public.admins, public.sorteos, public.sorteo_premios,
  public.boletos, public.ganadores from public, anon, authenticated;
```

**Todas las funciones** se crean con `set search_path = ''` y referencias calificadas
por esquema, sin SQL dinámico. Al final de la segunda migración se revoca `execute` a
`public`, `anon`, `authenticated` y `service_role`, y la sección 6 lo vuelve a
conceder solo sobre las tres RPC iniciales que el navegador necesita. La migración de
caducidad repite el revoke sobre sus funciones y no concede ninguna a la API. La sexta
migración agrega una cuarta RPC pública que solo devuelve el booleano de cuarentena.

```sql
revoke all on function public.calcular_tickets_gratis(integer),
  public.calcular_monto_total(integer, integer), public.generar_codigo_boleto(),
  public.registrar_auditoria(), public.comprar_tickets(uuid, integer, text, text, text, text),
  public.registrar_revision_boleto(), public.liberar_tickets_rechazados()
  from public, anon, authenticated, service_role;
```

### Fórmula de tickets gratis y previsualización del total

```sql
-- 4 comprados = 1 gratis, y así sucesivamente
create function public.calcular_tickets_gratis(cantidad integer)
returns integer language plpgsql immutable security invoker set search_path = '' as $$
begin
  if cantidad is null or cantidad <= 0 then
    raise exception 'La cantidad comprada debe ser un entero positivo' using errcode = '22023';
  end if;
  return cantidad / 4;
end;
$$;

-- Previsualización del total. Con cantidad 0 devuelve ceros (es el estado inicial del
-- selector de TicketsSection, no un error); con precio inválido o desbordamiento, lanza.
create function public.calcular_monto_total(p_cantidad integer, p_precio_boleto integer)
returns table(cantidad_comprada integer, tickets_gratis integer, cantidad_total integer, monto_total integer)
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_gratis integer; v_total bigint; v_monto bigint;
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
```

`calcular_monto_total` es **solo previsualización**: el precio que recibe nunca
determina el de una compra real — ese sale de `sorteos` dentro de `comprar_tickets`.

### Código del pase digital

```sql
create sequence public.boletos_codigo_seq as bigint no cycle;
revoke all on sequence public.boletos_codigo_seq from public, anon, authenticated;

create function public.generar_codigo_boleto()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_prefijo text; v_secuencia text;
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
```

**Por qué `greatest(5, char_length(...))` y no `lpad(..., 5, '0')` a secas:** `lpad`
*trunca* cuando el texto es más largo que el ancho pedido, así que a partir del
boleto 100 000 el código pasaría de `'100000'` a `'10000'` y chocaría con el `unique`
de `codigo`. Con `greatest` el código conserva un mínimo de cinco dígitos y crece sin
truncarse.

La secuencia es **global a todos los sorteos**, no por edición: la edición 2 puede
empezar en `PD-05231`. El código no codifica `edicion_numero` y no es un secreto de
acceso. `nextval` no es transaccional, así que una compra fallida deja un hueco en la
numeración — es normal y no representa cupo vendido.

### Compra atómica

```sql
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

-- SECURITY DEFINER: permite comprar con la anon key sin conceder escritura directa
-- sobre boletos ni lectura de datos personales. El cliente no elige precio, código,
-- cantidad gratis, estado ni auditoría.
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
```

Lo que valida antes de escribir: cantidad positiva y sin desbordar `integer`, nombre
(1–200), teléfono y documento (1–32), `tipo_documento` en la whitelist, sorteo activo,
**ventana de ventas abierta** (`fecha_inicio_ventas <= now()` y `fecha_fin_ventas` nula
o futura), ausencia de una pausa en `cuarentenas_sorteo`, **tope por compra**
(`max_tickets_por_compra`) y cupo disponible contando los gratis. El lock mantiene
estable la fila del sorteo frente a otros escritores durante la consulta; por MVCC solo
puede observar pausas ya confirmadas. Como el job escribe la pausa sin soltar ese lock,
una compra concurrente con la detección espera su commit y recibe `P1004`. Nada de esto
acredita identidad ni posesión del teléfono o el documento.

**Códigos de error propios.** El frontend los distingue por `error.code`, sin
interpretar el texto del mensaje:

| `error.code` | Lo lanza | Significado |
|---|---|---|
| `P1001` | `comprar_tickets` | La cantidad comprada supera `max_tickets_por_compra`; el mensaje incluye el máximo. Mostrarlo en vez del mensaje genérico de falta de cupo. |
| `P0001` | `comprar_tickets` | No hay cupo, la venta no está habilitada o el monto excede el límite admitido. |
| `P1002` | `registrar_revision_boleto` | El boleto caducó mientras el admin lo revisaba: validarlo o devolverlo a `pendiente` falla. Hay que recargar; no puede reactivarse. |
| `P1003` | `liberar_tickets_rechazados`, `caducar_boletos_pendientes` | El contador del sorteo no coincide con la suma de sus reservas. El rechazo (manual, de servicio o por caducidad) se revierte y la edición requiere conciliación manual. |
| `P1004` | `comprar_tickets` | La edición activa tiene una pausa persistente causada por `P1003`. Se distingue de falta de cupo o tope. |
| `P1005` | `conciliar_contador_sorteo` | Las reservas verificadas superan `tickets_totales`; hay que rechazar reservas durante la pausa hasta que quepan y volver a conciliar. |
| `P1006` | `bloquear_validacion_en_cuarentena` | Se intentó validar un boleto (o devolverlo a `pendiente`) antes de conciliar la edición. Rechazar sí se permite durante la pausa. |

Superar el tope no crea boletos ni modifica el contador.

**Reservas fantasma:** no las hay por fallo técnico. El `UPDATE` del contador y el
`INSERT` del boleto viven en la misma transacción, así que si el insert falla el
contador vuelve atrás. Lo que sí retiene cupo es un boleto que queda en `pendiente` y
nunca se paga — eso lo resuelve la caducidad: pasado el TTL de la edición, el job lo
rechaza y el liberador devuelve su cupo (ver "Caducidad de pendientes").

### Revisión de pagos y liberación de cupo

Versión vigente: la migración de caducidad reemplaza ambas funciones y recrea sus
triggers (el revisor ahora también corre en `INSERT`; el liberador pasó a `BEFORE`).

```sql
-- El servidor decide quién y cuándo revisó; lo que mande el cliente en
-- validado_por / validado_en se descarta. También asigna pendiente_desde y el motivo.
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
    -- Sin cambio de estado no se toca la revisión ni el inicio del pendiente
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
    -- Volver a pendiente desde validado limpia la revisión y concede un plazo completo
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
    -- Una revisión de servicio ('ocr:nequi', 'sistema:caducidad') debe identificarse
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

create trigger trg_registrar_revision_boleto
  before insert or update on public.boletos
  for each row execute function public.registrar_revision_boleto();

-- Comprobar y liberar ANTES de cambiar la fila conserva la misma invariante
-- también en UPDATE de varios boletos: las filas anteriores ya liberaron cupo
-- y esta todavía participa en la suma. Un AFTER ROW vería todos los rechazos
-- de la sentencia antes de haber descontado sus reservas.
-- SECURITY DEFINER porque el admin no tiene permiso de escritura sobre tickets_vendidos.
-- Versión de la sexta migración: con la edición en pausa el contador no es confiable,
-- así que un rechazo no lo descuenta ni aplica la guarda P1003 (la conciliación o el
-- job al verificar igualdad lo recalculan). El lock del sorteo va primero, para que un
-- rechazo concurrente con la conciliación vea la pausa ya levantada y descuente normalmente.
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

create trigger trg_liberar_tickets_rechazados
  before update of estado on public.boletos
  for each row execute function public.liberar_tickets_rechazados();
```

**Libera exactamente una vez.** La guarda `old.estado <> 'rechazado'` hace que repetir
el `update` a `rechazado` no descuente de nuevo, y `tickets_vendidos >= old.cantidad_total`
impide dejar el contador en negativo (si no se cumple, falla en vez de corromper el
dato). Se libera `cantidad_total`, o sea comprados **más** gratis: exactamente lo que
se reservó. Es la **única** vía que descuenta del contador, también para la caducidad.

**Guarda del contador (`P1003`).** Antes de descontar, el liberador bloquea el sorteo y
compara `tickets_vendidos` con la suma de `cantidad_total` de los boletos no rechazados
de la edición. Si no coinciden —por ejemplo, un boleto heredado que se insertó sin
reservar cupo— lanza `P1003` y revierte estado, auditoría y liberación: que la cantidad
quepa en el contador no demuestra que ese boleto haya reservado. Aplica igual a rechazos
manuales, de servicio y por caducidad en una edición **sin pausa**. Cuando el job ya
pausó la edición (`cuarentenas_sorteo`), el rechazo se acepta sin guarda y sin descontar:
el contador se recalcula completo con la RPC auditada `conciliar_contador_sorteo`.

**BEFORE, no AFTER.** El liberador pasó de `AFTER UPDATE` a `BEFORE UPDATE OF estado`
para admitir rechazos múltiples sanos: la suma todavía incluye la fila actual y las
anteriores de la misma sentencia ya descontaron. Consecuencia para el panel: un
`UPDATE` de varias filas bloquea el sorteo al procesar la primera y luego espera la
siguiente, lo que puede producir deadlock (pendiente #4).

**Motivo del rechazo.** El revisor calcula motivo, autor y fecha; el cliente no los elige:

| `motivo_rechazo` | `validado_por` | Origen |
|---|---|---|
| `manual` | `admin:<user_id>` | Decisión del admin (también si un admin intenta enviar `sistema:caducidad`) |
| `caducidad` | `sistema:caducidad` | Vencimiento automático; solo desde `pendiente` |
| `servicio` | Identificador del servicio, p. ej. `ocr:nequi` | Otro proceso confiable |
| `null` | Según estado | Pendiente o validado |

Un admin puede **corregir `motivo_rechazo` sin cambiar el estado**: el servidor registra
`motivo_corregido_por`/`motivo_corregido_en`, conserva `validado_por`/`validado_en`
como autor y fecha del rechazo original y no toca el contador. Usuarios comunes y
`service_role` no pueden. Las fechas de revisión, entrada a pendiente y corrección usan
`statement_timestamp()`.

**`rechazado` es un estado terminal por diseño** — ver pendiente #5. Si el boleto caducó
mientras el admin lo revisaba, validarlo falla con `P1002`. El contrato recomendado para
el panel es actualizar por `id` **y** `estado = 'pendiente'`, pedir la fila modificada y
tratar cero filas como un conflicto que exige recargar.

### Auditoría de quién creó y modificó qué

```sql
create function public.registrar_auditoria()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_admin uuid;
begin
  if tg_op = 'UPDATE' then
    new.creado_por := old.creado_por;  -- el creador no se reescribe nunca

    -- Reservar o liberar tickets no modifica la autoría de la configuración:
    -- una compra anónima no debe borrar quién editó el sorteo por última vez.
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
```

`creado_por` y `actualizado_por` los asigna el trigger desde `auth.uid()`, nunca el
cliente (los grants de columna de la sección 6 ni siquiera los incluyen). Una operación
sin usuario —el seed de desarrollo, o una escritura con la clave de servicio— deja la
autoría en null.

**Buckets de Storage:** `sorteos-banners` (público, igual que en Premios Lorenzo) y `comprobantes-pago` (privado, sin políticas de navegador: su acceso futuro corresponde a una Edge Function con credenciales de servicio).

### Caducidad de pendientes

Un boleto `pendiente` retiene cupo hasta que alguien lo revisa. La cuarta migración
agrega un TTL por edición y un job de `pg_cron` que rechaza los pendientes vencidos con
motivo `caducidad`; el liberador devuelve su cupo. La quinta migración programa el job.
El detalle operativo (pruebas manuales, monitorización) está en `supabase/README.md`.

**Requisito: `pg_cron` habilitado antes de migrar.** Las migraciones no ejecutan
`CREATE EXTENSION`: en producción se habilita una vez desde el Dashboard y en local lo
instala `pnpm run db:reset:local` (sección 10). Ambas migraciones lo comprueban antes de
tocar nada y fallan con `55000` si falta la extensión o `42501` si faltan permisos:

```sql
-- Supabase habilita pg_cron por Dashboard; validar antes de cualquier DDL.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'Falta pg_cron: habilítalo antes de aplicar las migraciones de caducidad'
      using errcode = '55000', hint = 'Producción: Dashboard > Integrations > Cron. Desarrollo local: consulta supabase/README.md; instalar antes de db reset no basta porque recrea la base.';
  end if;

  if not has_schema_privilege(current_user, 'cron', 'USAGE')
    or not has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    raise exception 'El rol de migraciones necesita USAGE sobre cron y EXECUTE sobre cron.schedule'
      using errcode = '42501';
  end if;
end;
$$;
```

**Columnas nuevas y relleno de datos existentes.**

```sql
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
```

- **`ttl_pendientes_horas`**: entero obligatorio entre **1 y 168** (una semana), **24**
  por defecto y configurable por edición. Solo el admin lo escribe (grant de columna más
  la política `sorteos_admin_all`), y la auditoría de sorteos registra quién lo cambió.
- **`pendiente_desde`**: el revisor la asigna al insertar un pendiente y al volver de
  `validado` a `pendiente`, lo que concede un plazo completo aunque la compra sea vieja.
  Guardar un pendiente sin cambiar su estado conserva la fecha; al salir de pendiente se
  limpia (`created_at` conserva la compra original). La API no puede escribirla. Un boleto
  caduca cuando su antigüedad es **estrictamente mayor** que el TTL.
- **Datos anteriores**: los pendientes reciben un plazo completo desde la migración (no se
  infiere de `created_at`), y los rechazados se clasifican como `manual` si su autor empieza
  por `admin:`, o `servicio` si no. El relleno no cambia estados, fechas, autores ni contadores.
- **`motivo_rechazo`**: obligatorio solo en rechazados, con valores `manual`, `caducidad`
  o `servicio` (tabla de motivos en "Revisión de pagos y liberación de cupo").

**Permisos de boletos e índice del job.**

```sql
-- Toda alta, también desde una Edge Function, debe reservar mediante comprar_tickets.
-- Cerrar además las mutaciones de cantidades/sorteo y los borrados evita desajustes.
revoke all on public.boletos from service_role;
grant select, update (estado, validado_por, validado_en, metodo_pago, comprobante_url)
  on public.boletos to service_role;
grant update (motivo_rechazo) on public.boletos to authenticated;

create index idx_boletos_pendientes_caducidad
  on public.boletos(sorteo_id, pendiente_desde, id)
  where estado = 'pendiente';
```

`service_role` pierde `INSERT`, `DELETE`, `TRUNCATE` y la escritura general de boletos
que le daba la tercera migración. Conserva la lectura y la actualización de revisión,
método de pago y comprobante. La futura Edge Function de Nequi crea compras solo con
`comprar_tickets` y actualiza el pago o la revisión de ese boleto. El índice parcial
cubre únicamente los pendientes, en el orden en que el job los recorre por sorteo.

**Incidencias, cuarentena y resolución.**

```sql
create table public.incidencias_caducidad (
  -- Sin FK: registrar contención no debe volver a bloquear el boleto o el sorteo.
  boleto_id uuid primary key,
  sorteo_id uuid not null,
  codigo_error text not null,
  mensaje text not null,
  intentos integer not null default 1,
  primera_incidencia_en timestamptz not null,
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

revoke all on public.ediciones_en_cuarentena from public, anon, authenticated, service_role;
grant select on public.ediciones_en_cuarentena to authenticated;

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

create trigger trg_resolver_incidencia_caducidad
  after update of estado on public.boletos
  for each row when (new.estado <> 'pendiente')
  execute function public.resolver_incidencia_caducidad();

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
```

- **`incidencias_caducidad`** guarda una fila abierta por boleto que falló: código
  SQLSTATE, mensaje, intentos, primer fallo de esa misma causa (se conserva en los
  reintentos y se reinicia si cambia el código), último registro y próximo reintento. Es
  diagnóstico operativo por boleto; un `UPSERT` puede cambiar de `P1003` a `55P03` sin
  modificar la pausa de la edición.
- **`cuarentenas_sorteo`** es la fuente de verdad de la pausa. Tiene una fila por edición
  desde el primer `P1003` hasta que el job verifica igualdad o un admin ejecuta la
  conciliación. Validar un boleto y los errores `55P03` no la eliminan.
- **`ediciones_en_cuarentena`** muestra ese estado persistente, su motivo, desde cuándo
  existe y cuántas verificaciones fallaron. Por `security_invoker`, un admin ve también
  ediciones inactivas, una sesión sin admin ve cero filas y `anon` no tiene `SELECT`.
  **Cambio de contrato respecto de la quinta migración:** ya no lista ediciones que solo
  tienen contención `55P03` (no están en pausa), `motivos` trae `boleto_id` en `null` y
  `reintentar_desde` es siempre `null`. El detalle por boleto y los reintentos se consultan
  en `incidencias_caducidad`.
- **`sorteo_en_cuarentena(uuid)`** expone a `anon`, `authenticated` y `service_role`
  únicamente el booleano de una edición **activa**. No revela boletos, motivo, fechas ni
  intentos. `comprar_tickets` rechaza con `P1004` mientras exista la pausa confirmada.
- **Conciliación auditada**: `conciliar_contador_sorteo(uuid)` está disponible solo para
  un usuario autenticado presente en `admins`. Con la fila del sorteo bloqueada, calcula
  pendientes más validados, comprueba que no superen la capacidad, ajusta el contador,
  registra valor anterior/nuevo, admin y fecha en `conciliaciones_sorteo`, y recién después
  elimina `P1003` y la pausa. Si las reservas superan la capacidad devuelve `P1005` y no
  cambia nada. `service_role` no puede ejecutar la RPC.
- **Orden obligatorio: conciliar antes de validar.** Mientras la pausa exista, validar un
  boleto o devolverlo a `pendiente` devuelve `P1006`. Ni validar ni rechazar el boleto
  marcado levantan la pausa, y el diagnóstico `P1003` se conserva como evidencia hasta
  conciliar.
- **Edición sobrevendida (`P1005`)**: si las reservas superan la capacidad, el admin
  **rechaza** reservas durante la pausa hasta que quepan (se permite, y no descuenta del
  contador porque la conciliación lo recalcula) y luego concilia. La venta sigue pausada
  todo ese tiempo; recién después se validan los pagos.

**Job de caducidad.**

```sql
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

revoke all on function public.registrar_revision_boleto(), public.caducar_boletos_pendientes(),
  public.liberar_tickets_rechazados(), public.resolver_incidencia_caducidad()
  from public, anon, authenticated, service_role;
```

- **Una sola ejecución a la vez**, por un lock advisory transaccional, incluso si alguien
  la invoca a mano. `SECURITY INVOKER` sin `EXECUTE` para la API: corre con el rol que
  aplicó la migración.
- **Por sorteo y por boleto**: toma el boleto con `FOR UPDATE SKIP LOCKED` y después el
  sorteo con `FOR NO KEY UPDATE NOWAIT`, siempre en orden **boletos → sorteos**. Repite la
  comprobación del TTL con el sorteo bloqueado: reducirlo afecta pendientes existentes y
  aumentarlo les da más margen. También procesa sorteos cerrados o inactivos.
- **Contador antes de caducar**: compara una vez por sorteo el contador con las reservas
  (y otra vez tras un fallo de fila). Si no coinciden, crea o actualiza la pausa por
  edición y el diagnóstico `P1003` mientras conserva el lock del sorteo; aplaza el
  boleto **1 hora** y sigue con las demás. No resta cupos ni corrige el contador. Cuando
  una ejecución posterior obtiene el lock y verifica igualdad, elimina la pausa antes de
  caducar; un fallo posterior de esa fila revierte también esa limpieza.
- **Aislamiento de errores**: cada fila corre en un bloque `EXCEPTION`, así que un error
  revierte solo esa fila y sus triggers. Un error ordinario aplaza la fila **1 hora**. La
  contención del sorteo (`55P03`, incluido `lock_timeout`) abandona esa edición por
  **10 minutos** sin esperar por cada boleto.
- **Presupuesto**: hasta **1000 intentos** por llamada y 1000 candidatos por sorteo,
  ordenados por `pendiente_desde`. Los boletos que están bloqueados no consumen el
  presupuesto. Si hay más vencidos, se procesan en las ejecuciones siguientes.
- **No toca el contador directamente**: cambia `pendiente` → `rechazado` con
  `validado_por = 'sistema:caducidad'`, y el liberador descuenta comprados más gratis en la
  misma fila. Repetir el job no vuelve a seleccionar rechazados.
- **Carrera con el admin**: si el admin confirma la validación primero, el boleto ya no
  caduca, aunque haya pasado el umbral. Si el job confirma primero, la validación
  concurrente falla con `P1002`.

**Programación (quinta migración).**

```sql
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
```

El job `caducar-boletos-pendientes` corre cada **5 minutos** (288 veces al día): la
liberación ocurre en la primera ejecución posterior al vencimiento si no hay acumulación,
bloqueos ni fallos, sin prometer un máximo estricto de cinco minutos. `lock_timeout = '5s'`
limita las esperas que no se pudieron evitar y `statement_timeout = '2min'` es un límite
de emergencia. Los errores capturados se consultan en `incidencias_caducidad`: el job
puede figurar como exitoso en `cron.job_run_details` aunque haya apartado boletos o
ediciones. Si el proyecto está pausado o cron detenido, los pendientes conservan su cupo
hasta que vuelva a correr.

**Límites conocidos, sin cambios en esta entrega:** una cancelación global
(`statement_timeout`, desconexión o fallo al registrar la incidencia) revierte toda la
corrida y no garantiza progreso de ese lote (caso de livelock abierto). El presupuesto de
1000 intentos por corrida tampoco reparte entre ediciones.

### Fecha del sorteo

`20260917000100_agregar_fecha_sorteo.sql` agrega el momento en que se juega cada edición.
Es opcional para no invalidar las ediciones existentes; si está, va después de abrir las
ventas y no antes del cierre. La franja `FechasSorteoSection`, entre el Hero y los premios, muestra esta fecha y la del
cierre en hora de Colombia, con una cuenta regresiva hasta el cierre de ventas y, cuando
cierran, hasta el sorteo.

```sql
alter table public.sorteos add column fecha_sorteo timestamptz;

alter table public.sorteos add constraint sorteos_fecha_sorteo_valida check (
  fecha_sorteo is null
  or (fecha_sorteo > fecha_inicio_ventas and (fecha_fin_ventas is null or fecha_sorteo >= fecha_fin_ventas))
);

-- Los grants por columna no incluyen columnas nuevas: el admin necesita poder escribirla.
grant insert (fecha_sorteo) on public.sorteos to authenticated;
grant update (fecha_sorteo) on public.sorteos to authenticated;
```

## 3. Pagos: fase manual ahora, automatizada después

La forma de pago queda en blanco por ahora — el esquema ya está preparado para no requerir migraciones cuando se implemente.

**Fase 1 (ahora):** el formulario de registro público llama a la RPC `comprar_tickets` (ver sección 2), que reserva los tickets y crea el boleto en `estado = 'pendiente'`, con `metodo_pago` y `comprobante_url` en null (no se exige comprobante todavía). Desde el panel admin se agrega una vista `AdminBoletosPage` donde el admin revisa manualmente y cambia `estado` a `validado` o `rechazado`. Quien graba `validado_por = 'admin:<user_id>'`, `validado_en = statement_timestamp()` y `motivo_rechazo` es el trigger `registrar_revision_boleto`, no el panel: el cliente solo manda `estado`, y lo que enviara en esos campos se descarta. Si la edición está en cuarentena, el panel debe llamar primero a `conciliar_contador_sorteo` y después validar el boleto; validar antes devuelve `P1006`. Si la conciliación responde `P1005` (reservas sobre la capacidad), el admin rechaza durante la pausa las reservas que no se honrarán y vuelve a conciliar. Si se rechaza, el trigger `liberar_tickets_rechazados` comprueba el contador (`P1003`) y devuelve esos tickets al cupo disponible, una sola vez; el boleto queda en un estado terminal y no se puede reactivar (ver pendiente #5). Si nadie lo revisa antes de `ttl_pendientes_horas` (24 h por defecto) contadas desde `pendiente_desde`, el job de caducidad lo rechaza con motivo `caducidad` y devuelve su cupo; si el admin intenta validarlo después, recibe `P1002` (ver "Caducidad de pendientes" en la sección 2).

**Fase 2 (cuando se defina el pago, ej. Nequi):** se agrega el upload de comprobante en el formulario público + una Edge Function `validate-comprobante-nequi` que hace OCR, completa `metodo_pago` y `comprobante_url`, y actualiza `estado`/`validado_por = 'ocr:nequi'` automáticamente. Con `service_role` solo puede actualizar revisión, método de pago y comprobante: si alguna vez necesita registrar una compra, usa `comprar_tickets`, porque el `INSERT` directo sobre `boletos` está revocado. No cambia la estructura de tablas, solo el flujo — la revisión manual puede seguir existiendo como respaldo para los casos que el OCR no logre leer.

- **Pendiente crítico para la fase 2:** capturas reales de comprobantes de Nequi para identificar el texto ancla y el formato de monto/fecha, igual que ya hicieron con Yape/BCP.

## 4. Formato de moneda

```ts
// utils/currency.ts
const formatoCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});
// formatoCOP.format(5000) → "$ 5.000"
// formatearCOP(5000)      → "$5.000"  (quita el espacio duro de es-CO, como en el diseño)
```

## 5. Estructura de carpetas propuesta

```
src/
  main.tsx
  App.tsx                      // rutas + layouts
  pages/
    LandingPage.tsx
    RegisterFormPage.tsx
    TicketLookupPage.tsx
  components/
    layout/
      Header.tsx                // logo + botón burger
      MobileNav.tsx              // menú fullscreen (Premios/Cómo participar/Tickets/Ganadores)
      MobileStickyCta.tsx        // CTA fijo inferior en mobile
      CursorDot.tsx              // punto que sigue el cursor y cambia de color por sección
      Footer.tsx
    landing/
      HeroSection.tsx            // badges + countdown + contador de tickets registrados
      PremiosSection.tsx
        PrizeCardMajor.tsx       // premio "mayor", card grande
        PrizeCardSecondary.tsx   // premios "secundarios" (top pick / bonus), se repite
      Reveal.tsx                 // aparición al hacer scroll (texto que sube / foto que gira)
      Photo.tsx                  // imagen_url o el placeholder del prototipo si es null
      MecanicaSection.tsx        // 3 pasos + preview del pase digital
        DigitalPassPreview.tsx   // código de ejemplo, precio, trama QR decorativa, estado
      TramaQr.tsx                // trama decorativa del pase, compartida con el pase emitido
      TicketsSection.tsx         // selector de cantidad + quick-picks + total, o aviso si no hay venta
      TransparenciaSection.tsx   // stats + barra de progreso vendidos/restantes
      GanadoresSection.tsx       // Hall of fame — lista con detalle al hacer hover; no se
                                 // renderiza mientras `ganadores` esté vacía
      FaqSection.tsx             // acordeón de preguntas frecuentes
  store/
    useSorteoStore.ts           // Zustand — sorteo seleccionado (equivalente a Pinia)
  hooks/
    useSorteos.ts               // equivalente al composable useSorteos (+ useSorteoActual / useSorteoPorId)
    usePremios.ts               // sorteo_premios de un sorteo, por `orden`
    useCountdown.ts              // cuenta regresiva hasta fecha_fin_ventas
    useScrollReveal.ts           // animación de aparición al hacer scroll
    useParallax.ts              // desplazamiento vertical de las fotos
    useMontoTotal.ts            // preview con calcular_monto_total (no reserva cupo)
    useMomentoAlcanzado.ts      // true desde una fecha (apertura/cierre de ventas), un solo timer
    useComprarTickets.ts        // compra con comprar_tickets (reserva cupo); sin reintentos
    useGanadores.ts             // tabla ganadores para el Hall of fame
  lib/
    supabase.ts
  utils/
    currency.ts
    number.ts                   // enteros con separador de miles (es-CO)
    tickets.ts                  // cupo por compra, máximo comprable y estado de venta
    registro.ts                 // esquema Zod del registro, espejo de los CHECK y de comprar_tickets
```

## 6. Perfiles: público vs admin

Dos superficies sobre el mismo repo: la web pública (registro/consulta de boletos) y un panel `/admin/*` protegido para editar sorteos y premios (precios, nombres, imágenes, fechas).

**Supuesto de partida:** un solo rol "admin" plano, sin niveles de permiso (editor vs super-admin). Si necesitas distinguir roles, se ajusta agregando una columna `rol` a la tabla `admins`.

**Auth:** Supabase Auth (email/password) + tabla de whitelist de administradores. Este diseño ya soporta **varias personas usando el panel** sin cambios: cada una tiene su propia cuenta y una fila en `admins` — la política RLS valida "¿está en `admins`?", no un usuario específico.

Como son varios editando sorteos y premios, `sorteos` y `sorteo_premios` llevan
auditoría básica (`creado_por` / `actualizado_por`). Esas columnas **las rellena un
trigger** a partir de `auth.uid()`, no el cliente — ver "Auditoría de quién creó y
modificó qué" en la sección 2.

Permisos y políticas tal como se aplican en la tercera migración. Lo que la migración de
caducidad cambia después está señalado en comentarios, y su SQL figura en la sección 2
("Caducidad de pendientes"):

```sql
grant usage on schema public to anon, authenticated, service_role;

grant select on public.sorteos, public.sorteo_premios, public.ganadores to anon, authenticated;
grant select on public.admins, public.boletos to authenticated;

-- El contador y la auditoría se administran en el servidor, no desde el formulario:
-- tickets_vendidos, creado_por y actualizado_por quedan fuera del grant de columnas.
grant insert (
  id, edicion_numero, nombre, subtitulo, descripcion, banner_url, color_hex,
  precio_boleto, tickets_totales, max_tickets_por_compra, codigo_prefijo,
  fecha_inicio_ventas, fecha_fin_ventas, activo
) on public.sorteos to authenticated;
grant update (
  edicion_numero, nombre, subtitulo, descripcion, banner_url, color_hex,
  precio_boleto, tickets_totales, max_tickets_por_compra, codigo_prefijo,
  fecha_inicio_ventas, fecha_fin_ventas, activo
) on public.sorteos to authenticated;
-- Caducidad: ttl_pendientes_horas recibe su propio grant de insert y update.
-- Fecha del sorteo: fecha_sorteo también (ver "Fecha del sorteo" en la sección 2).
grant delete on public.sorteos to authenticated;
grant insert, update, delete on public.sorteo_premios, public.ganadores to authenticated;

-- Del boleto solo se puede tocar la revisión, y el trigger igual la recalcula.
-- No hay insert ni delete desde el navegador: así no se elude la reserva de cupo.
-- Caducidad: se agrega update (motivo_rechazo) para la corrección auditada del admin.
grant update (estado, validado_por, validado_en) on public.boletos to authenticated;

-- Caducidad: sobre boletos, service_role pierde este grant all y conserva solo
-- select y update (estado, validado_por, validado_en, metodo_pago, comprobante_url).
grant all on public.admins, public.sorteos, public.sorteo_premios,
  public.boletos, public.ganadores to service_role;
grant all on sequence public.boletos_codigo_seq to service_role;

-- Las tres funciones públicas iniciales; la sexta migración agrega el booleano
-- sorteo_en_cuarentena(uuid) con su propio grant.
grant execute on function public.calcular_tickets_gratis(integer),
  public.calcular_monto_total(integer, integer),
  public.comprar_tickets(uuid, integer, text, text, text, text)
  to anon, authenticated, service_role;

-- Cada usuario consulta únicamente su propia pertenencia. No hay altas ni cambios
-- desde la API. No consulta admins dentro de su propia política, para evitar
-- recursión de RLS.
create policy admins_select_propio on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Lectura pública solo de sorteos activos
create policy sorteos_select_publico on public.sorteos
  for select to anon, authenticated
  using (activo = true);

-- Admin: control total
create policy sorteos_admin_all on public.sorteos
  for all to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins where user_id = (select auth.uid())));

-- Los premios siguen la visibilidad de su sorteo: los de un borrador (activo = false)
-- no se filtran al público junto con su valor_referencial.
create policy premios_select_publico on public.sorteo_premios
  for select to anon, authenticated
  using (exists (
    select 1 from public.sorteos
    where sorteos.id = sorteo_premios.sorteo_id and sorteos.activo = true
  ));

create policy premios_admin_all on public.sorteo_premios
  for all to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins where user_id = (select auth.uid())));

-- Datos personales: boletos no tiene política ni permiso SELECT para anon, ni
-- siquiera filtrada por documento. Una sesión autenticada que no esté en admins
-- tampoco satisface estas políticas y ve cero filas.
create policy boletos_select_admin on public.boletos
  for select to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())));

create policy boletos_update_admin on public.boletos
  for update to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins where user_id = (select auth.uid())));

create policy ganadores_select_publico on public.ganadores
  for select to anon, authenticated
  using (true);

create policy ganadores_admin_all on public.ganadores
  for all to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins where user_id = (select auth.uid())));

insert into storage.buckets (id, name, public) values
  ('sorteos-banners', 'sorteos-banners', true),
  ('comprobantes-pago', 'comprobantes-pago', false)
on conflict (id) do nothing;

-- Storage: banners públicos para lectura, solo admin escribe/reemplaza/borra
create policy banners_select_publico on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'sorteos-banners');

create policy banners_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sorteos-banners'
    and exists (select 1 from public.admins where user_id = (select auth.uid()))
  );

create policy banners_update_admin on storage.objects
  for update to authenticated
  using (
    bucket_id = 'sorteos-banners'
    and exists (select 1 from public.admins where user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'sorteos-banners'
    and exists (select 1 from public.admins where user_id = (select auth.uid()))
  );

create policy banners_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sorteos-banners'
    and exists (select 1 from public.admins where user_id = (select auth.uid()))
  );

-- comprobantes-pago no recibe políticas de navegador: queda reservado al servicio.
```

Resumen de quién ve y hace qué:

| Recurso | Público (`anon`) | Sesión sin admin | Admin de la whitelist |
|---|---|---|---|
| Sorteos | Lee los activos | Lee los activos | Lee todos y administra la configuración |
| Premios | Lee los de sorteos activos | Ídem | Lee, crea, edita y elimina |
| Ganadores | Lee | Lee | Lee, crea, edita y elimina |
| Boletos | Sin acceso | Cero filas visibles | Lee todos, cambia `estado` y corrige `motivo_rechazo` (auditado) |
| Incidencias, cuarentenas, conciliaciones y `ediciones_en_cuarentena` | Sin acceso | Cero filas visibles | Lee; concilia por RPC antes de revisar el boleto |
| `sorteo_en_cuarentena` | Consulta solo el booleano `P1003` | Ídem | Ídem; el detalle sigue en la vista admin |
| Admins | Sin acceso | Solo su propia fila | Solo su propia fila |
| Banners | Lee | Lee | Lee, sube, reemplaza y elimina |
| Comprobantes | Sin acceso | Sin acceso | Sin acceso directo desde el navegador |

**Alta de administradores:** no se puede hacer desde la API — `admins` no tiene
política de `insert` ni grant de escritura. Hay que crear la cuenta en Supabase Auth
y agregar su `user_id` a `admins` por una vía administrativa (SQL Editor o clave de
servicio). La clave `service_role` nunca debe llegar al navegador.

**Nada de `insert` ni `delete` sobre `boletos` desde el navegador**, ni siquiera para
un admin: si necesita registrar una compra, usa la misma RPC `comprar_tickets`. Así
no hay forma de crear boletos sin reservar cupo ni de borrarlos sin devolverlo. Desde la
migración de caducidad **tampoco `service_role`** puede insertar, borrar, truncar ni
cambiar cantidades, sorteo o `pendiente_desde`: una Edge Function crea compras solo por
`comprar_tickets`. El job de caducidad tampoco escribe el contador: solo lo descuenta el
liberador.

**Rutas y componentes nuevos:**

```
pages/
  admin/
    AdminLoginPage.tsx
    AdminDashboardPage.tsx
    AdminSorteosPage.tsx        // listado + crear/editar sorteo
    AdminPremiosPage.tsx        // CRUD de premios por sorteo
    AdminBoletosPage.tsx        // revisión manual de pagos (fase 1): aprobar/rechazar boletos
                                 // (update por id y estado = 'pendiente'; P1002; locks en pendiente #4)
    AdminGanadoresPage.tsx      // registrar ganador de una edición (Hall of fame)
components/
  admin/
    ProtectedRoute.tsx          // valida sesión Supabase antes de renderizar /admin/*
    SorteoForm.tsx               // edicion_numero, nombre, subtitulo, descripcion, precio_boleto, tickets_totales,
                                 // max_tickets_por_compra, ttl_pendientes_horas (1–168), codigo_prefijo, fechas,
                                 // color_hex, banner_url, activo
    PremioForm.tsx                // nombre, tipo (mayor/secundario), badge_label, valor_referencial, imagen (upload), orden
    GanadorForm.tsx                // nombre, ciudad, premio, foto, fecha de entrega
    ImageUploader.tsx             // sube a bucket sorteos-banners
```

`ProtectedRoute` redirige a `/admin/login` si no hay sesión activa; no necesita verificar la tabla `admins` en el cliente (eso ya lo garantiza RLS en el servidor) — solo gatea la navegación.

## 7. Diseño: "Purple Draw"

Ya lo revisé. Dos cosas importantes antes del detalle:

- **El diseño confirma el negocio:** es un sorteo temático de BTS ("Gana una Experiencia Purple", disclaimer de no afiliación con HYBE/BIGHIT/BTS en el footer) — el mismo tipo de producto que cincotreboles.com, solo que para Colombia. Todo lo demás ya calza con lo que veníamos armando.
- **El archivo exportado no es código reutilizable.** Claude Design empaqueta la página en su propio formato interno (bindings `{{ }}`, directivas `sc-if`/`sc-for`, una clase `DCLogic`) — no es React ni HTML plano para copiar. Es una referencia visual y de comportamiento; hay que traducirla a mano a los componentes de React de abajo. Queda versionado en `docs/design/purple-draw-landing.html` (sin su runtime `support.js`, así que no se abre en el navegador: se lee), y los tokens que salen de él viven en el `@theme` de `src/index.css`.

**Secciones de la landing y a qué corresponden:**

| Sección del diseño | Componente | Datos que necesita |
|---|---|---|
| Header + menú fullscreen | `Header`, `MobileNav` | — (estático) |
| Hero: badges, countdown, contador de tickets | `HeroSection` | `sorteos.fecha_fin_ventas` (countdown), `tickets_totales`/`tickets_vendidos` (contador, lectura directa) |
| Premios: 1 mayor + 3 secundarios | `PremiosSection` | `sorteo_premios` filtrado por `tipo` |
| Mecánica: 3 pasos + pase digital de ejemplo | `MecanicaSection`, `DigitalPassPreview` | `precio_boleto`, `ttl_pendientes_horas`, `codigo_prefijo`, `edicion_numero`. El código del pase es de ejemplo (`PD-00000`, fuera de la secuencia real): el público no lee `boletos` |
| Tickets: selector de cantidad + quick-picks | `TicketsSection` | `calcular_monto_total` (preview de total y gratis); límite con `max_tickets_por_compra`, `tickets_totales`/`tickets_vendidos` y la ventana de ventas. `comprar_tickets` queda para `RegisterFormPage` |
| Transparencia: stats + barra de progreso | `TransparenciaSection` | `tickets_totales` y `tickets_vendidos` — lectura directa, sin agregación |
| Ganadores (Hall of fame) | `GanadoresSection` | tabla `ganadores` |
| FAQ | `FaqSection` | estático por ahora (ver pendiente #2) |
| Footer | `Footer` | — (estático) |

**Modelo "4+1 gratis" en Tickets (resuelto):** el diseño mostraba "5 tickets · $25.000 COP" sin comunicar el gratis. Los quick-picks muestran ahora "5 tickets + 1 gratis · $25.000 COP" y bajo el total se detalla "Recibes 6 tickets: 5 comprados + 1 gratis". Montos y gratis salen de `calcular_monto_total`; el cliente solo replica `cantidad + cantidad / 4` para acotar el selector al cupo restante, y `comprar_tickets` vuelve a validarlo.

**Cuándo no se ofrece el selector:** si la edición no abrió ventas, las cerró (o está inactiva) o no le queda cupo para una sola compra, `TicketsSection` muestra un aviso sin selector ni CTA. El máximo por compra es el menor entre `max_tickets_por_compra`, lo que cabe en el cupo restante contando los gratis y el rango de `integer` del monto. Se recalcula con cada refetch del sorteo, y la apertura o el cierre de ventas se aplican a la hora exacta sin recargar. El servidor ya expone `sorteo_en_cuarentena`; conectar ese booleano a `TicketsSection` queda para el cambio de frontend. Aunque la UI aún no lo muestre, `comprar_tickets` bloquea la venta con `P1004`.

**Textos del prototipo ajustados al flujo real (sección 3):** el paso 2 prometía "pasarela verificada y confirmación inmediata" y el 3, que el código "llega al instante a tu correo"; la revisión del pago es manual y no se guarda correo. El total decía "un código único por cada participación", pero cada compra genera un solo boleto con un código. El pase decía "Escanea para validar", y no existe validación por QR.

**Campos nuevos que salieron de revisar el diseño** (ya aplicados en la sección 2): `edicion_numero`, `tickets_totales` y `tickets_vendidos` en `sorteos`; `tipo`/`badge_label`/`valor_referencial` en `sorteo_premios` (reemplazando `es_premio_principal`); `codigo` único por boleto (el "pase digital", generado por trigger); tabla `ganadores` nueva para el Hall of fame.

## 8. Escalabilidad

Lo más importante primero — el punto donde un sitio de sorteos realmente se rompe bajo carga es la compra concurrente de tickets, así que el diseño de datos ya lo prioriza:

1. **Sin sobreventa bajo concurrencia.** `comprar_tickets` (sección 2) toma un lock breve de la fila del sorteo, consulta la pausa confirmada y reserva con un `UPDATE ... WHERE tickets_vendidos + incremento <= tickets_totales`. El lock es por fila, así que ediciones distintas no se bloquean entre sí. No vuelve visible una detección aún no confirmada: una compra que obtuvo el lock primero termina antes, y ese intento del job registra `55P03` en vez de detectar. Para cerrar la ventana contraria, el job escribe `cuarentenas_sorteo` sin lanzar excepción, así que conserva el lock hasta su commit; una compra que llega durante la detección espera y luego recibe `P1004`. Si esa espera supera el `statement_timeout` del rol (3 s para `anon`), la compra falla por timeout: tampoco vende.
2. **Contador de lectura barata.** `tickets_vendidos` es denormalizado — el Hero y la barra de progreso lo leen directo, sin agregación. Se mantiene consistente con el trigger `liberar_tickets_rechazados`, que lo decrementa cuando se rechaza un boleto (manual, de servicio o por caducidad). Antes de descontar, ese trigger suma las reservas de la edición para detectar descuadres (`P1003`): es un costo por rechazo, también dentro del job. La compra no calcula ese `SUM()`; solo hace un `EXISTS` por clave primaria sobre `cuarentenas_sorteo` para impedir ventas mientras se concilia la edición.
3. **Índices** en las columnas por las que se filtra seguido: `boletos.sorteo_id`, `boletos.estado` (para `AdminBoletosPage`), `sorteo_id` en `sorteo_premios`/`ganadores`, y `premio_id`/`boleto_id` en `ganadores` para resolver el Hall of fame sin recorrer la tabla. El job de caducidad usa el índice parcial `idx_boletos_pendientes_caducidad` (`sorteo_id, pendiente_desde, id` solo sobre pendientes), que no crece con los boletos ya revisados. `boletos.numero_documento` también está indexado, pero hoy **no lo usa nadie**: la consulta pública por documento está cerrada hasta decidir el pendiente #6.
4. **Code-splitting del bundle:** cargar `/admin/*` con `React.lazy` + `Suspense` en vez de en el bundle principal — los visitantes públicos (que son la mayoría del tráfico) no descargan el código del panel admin. `@supabase/supabase-js` ya entra en el bundle público porque la landing lee `sorteos` y `sorteo_premios`; Vite avisa que el chunk principal supera los 500 kB minificados.
5. **Cacheo:** TanStack Query ya evita refetchear lo mismo en cada render; para las imágenes de premios/banners (que se comparten mucho por WhatsApp), usar las transformaciones de Supabase Storage o un CDN para servir tamaños optimizados en vez de la imagen original completa.
6. **Protección contra abuso, no solo contra tráfico legítimo:** un sorteo con tickets gratis por volumen es un objetivo típico de bots/scripts. Ya está aplicado el tope por compra (`sorteos.max_tickets_por_compra`, default 50), que impide que una sola llamada a la RPC se lleve todo el cupo restante, y la caducidad de pendientes limita cuánto tiempo retienen cupo las reservas abandonadas (aunque no impide volver a reservar). Siguen abiertos el captcha (hCaptcha/Turnstile) y la `idempotency_key` por envío para que un doble clic o un reintento de red no genere dos boletos — ver pendiente #3. Ojo: como `comprar_tickets` se puede invocar directamente con la anon key, un captcha puesto solo en el formulario se elude llamando la RPC a mano; tiene que validarse del lado del servidor.
7. **A futuro, si el tráfico crece mucho:** Supabase Pro ofrece réplicas de lectura y mayor cómputo — no hace falta diseñarlo ahora, pero la separación de la lectura pública (vía RLS de solo-lectura) del resto ya deja el camino libre para eso sin cambios de esquema.

## 9. Pendientes

1. **Capturas reales de comprobantes Nequi** — sigue pendiente, sin fecha aún.
2. **Términos y condiciones / Política de privacidad** del footer — ¿páginas reales o placeholder por ahora?
3. **Captcha + idempotencia en el registro público** — el tope por compra ya está en el esquema; falta decidir si el captcha y la `idempotency_key` entran desde el inicio o cuando haya tráfico real. La validación del captcha tiene que ocurrir en el servidor, no solo en el formulario.
4. **Protocolo de locks del panel de revisión (M3).** Las operaciones del panel deben tomar los locks en orden **boletos → sorteos**, como el job y el liberador; tomar primero el sorteo y luego un boleto invierte ese orden. Pero con el liberador en `BEFORE UPDATE` ese orden **ya no basta**. Un `UPDATE` que rechaza varios boletos del mismo sorteo bloquea el sorteo al procesar la primera fila y después espera la siguiente. Si otra transacción ya bloqueó uno de esos boletos y luego lo rechaza —respetando boletos → sorteos—, cada una espera a la otra y PostgreSQL aborta una con **`40P01`** (deadlock). Con el trigger `AFTER` anterior no ocurría. No se corrompen datos (la transacción abortada revierte estado, auditoría y liberación) y el job no entra en el ciclo, porque salta boletos bloqueados y pide el sorteo con `NOWAIT`. El panel debe:
   - rechazar **un boleto por sentencia**, pero eso solo evita el deadlock si **cada sentencia va en su propia transacción** (una petición por boleto): dos rechazos seguidos dentro de la misma transacción conservan el lock del sorteo igual que un `UPDATE` múltiple. La alternativa es bloquear primero todos los boletos afectados con `select ... for update order by id` y luego ejecutar el `UPDATE` múltiple en esa misma transacción;
   - reintentar la operación completa ante `40P01`, recargando los boletos;
   - actualizar por `id` **y** `estado = 'pendiente'` y tratar cero filas como conflicto (ganó la caducidad).
5. **`rechazado` es terminal por diseño.** Un boleto rechazado no se puede reactivar: su cupo ya volvió al contador y puede haberlo tomado otra persona, así que reactivarlo permitiría sobreventa. La red de seguridad contra un rechazo por error del admin va en la UI (`AdminBoletosPage`, con confirmación explícita antes de rechazar), **no en el esquema**. Si el rechazo fue un error, el camino es una compra nueva sujeta a disponibilidad.
6. **`TicketLookupPage` no tiene camino de consulta todavía.** Buscar solo por número de documento no demuestra identidad y permite enumerar documentos, así que no se expone ningún endpoint público de búsqueda —ni como `select` ni como RPC— hasta decidir el mecanismo: un OTP al teléfono registrado (con límites por IP y destinatario, caducidad corta y respuesta genérica exista o no el documento), o un token de alta entropía entregado al comprar, guardado solo como hash y revocable. No se debe reutilizar el código `PD-00001`, el documento ni el UUID del boleto como credencial. Mientras tanto la ruta `/consulta` queda sin implementar y el índice `idx_boletos_numero_documento` no tiene consumidor.
7. **`estado`, `tipo_documento`, `tipo` y `motivo_rechazo` salen como `string` en los tipos generados**, no como uniones: en la BD son CHECK constraints, no enums de Postgres, así que `supabase gen types` no puede estrecharlos y `Constants.public.Enums` viene vacío. Hay que decidir entre declarar las uniones a mano en el cliente (rápido, pero se desincroniza del esquema sin avisar) o convertirlos a enums de Postgres en una migración (los tipos generados quedan estrechos y sincronizados, a cambio de que agregar un valor nuevo sea una migración). Además, `src/lib/database.types.ts` ya incluye las columnas y objetos de la caducidad; hay que regenerarlo (`pnpm types` sobre una base con todas las migraciones) cada vez que cambie el esquema. Tras la sexta migración falta regenerarlo con `cuarentenas_sorteo`, `conciliaciones_sorteo` y `conciliar_contador_sorteo`.
8. **`service_role` todavía escribe `tickets_vendidos` sin auditoría.** La conciliación auditada `conciliar_contador_sorteo` es la única vía para el admin, pero `service_role` conserva el `grant all` sobre `sorteos` de la tercera migración. No puede borrar una pausa, pero si iguala el contador a las reservas, el siguiente job que verifique la edición la levanta sin dejar registro en `conciliaciones_sorteo`. Cerrarlo exige cambiar ese grant por uno de columnas que excluya `tickets_vendidos` (y la auditoría), y revisar antes qué necesita la futura Edge Function de Nequi.
## 10. Setup local

Requiere Docker corriendo y pnpm.

```bash
pnpm install              # incluye el CLI de Supabase como devDependency
pnpm run db:reset:local   # recrea la base local: 6 migraciones, pg_cron y seed (BORRA sus datos)
pnpm supabase start       # levanta el resto de servicios: API, Auth, Storage y Studio
pnpm types                # regenera src/lib/database.types.ts desde la base local
pnpm dev
```

**`pnpm run db:reset:local` reemplaza a `pnpm supabase db reset`.** Con el CLI 2.117.0
un `db reset` directo no deja `pg_cron` instalado: el reset borra la extensión, y el rol
`postgres` local no puede crearla. Por eso la cuarta migración falla con `55000`. El script
`supabase/scripts/reset-local.mjs` sirve también sin contenedor previo y se detiene ante
cualquier error:

1. `supabase db start` inicia Postgres sin aplicar migraciones ni seed.
2. `supabase db reset --local --version 20260915000300 --no-seed` recrea la base con las tres
   migraciones que no dependen de Cron.
3. Instala `pg_cron` con el superusuario real del contenedor local (`supabase_admin`) y le
   concede a `postgres` uso del esquema `cron` y de `cron.schedule`. No convierte a
   `postgres` en superusuario ni amplía permisos de la API.
4. `supabase db push --local --include-seed` aplica las dos migraciones de caducidad y
   carga el seed.

El rodeo es **exclusivo de local**: los comandos que aplican migraciones llevan `--local` y el script rechaza
`--linked`, `--db-url` o cualquier argumento que no sea `--workdir <directorio-local>`.
Detalles en `supabase/README.md`.

**Producción:** `pg_cron` se habilita **una sola vez** desde **Dashboard > Integrations >
Cron**, antes del primer `db push` que incluya las migraciones de caducidad. Si se omite,
esas migraciones fallan con `55000` antes de alterar tablas (o `42501` si faltan permisos);
tras habilitarlo se reintenta el push sin recrear la base. El script local no se usa allí.

El reset carga el seed al final: `supabase/config.toml` trae `[db.seed]` con
`sql_paths = ["./seeds/desarrollo.sql"]`. Ese seed crea un sorteo activo (5000 COP,
5000 tickets) con un premio mayor y tres secundarios, con UUID fijos para que
repetirlo no duplique filas. **Es solo para desarrollo**, está fuera de `migrations/`
y no crea administradores ni compradores.

**Pruebas de base de datos:** `pnpm supabase test db` corre las suites pgTAP de
`supabase/tests/` (`caducidad_regresion.sql` y `caducidad_contrato.sql`) contra la base
local. Cada una trabaja dentro de una transacción con `ROLLBACK` y se aísla de los
pendientes que ya existan en la base.

`supabase start` imprime la `API URL` y la `anon key` del entorno local: van en `.env`
(copiado de `.env.example`) como `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Sin
esas dos variables la app no arranca — `src/lib/supabase.ts` falla a propósito con un
mensaje explícito en vez de morir más adelante con un error opaco. Ojo: Vite las
**incrusta en tiempo de build**, así que también tienen que estar presentes al correr
`pnpm build` (en CI incluido), no solo en ejecución.

Para crear un admin en local: registra el usuario en Studio (Authentication) y luego,
desde el SQL Editor, `insert into public.admins (user_id, nombre) values ('<uuid>', 'Tu nombre');`.
