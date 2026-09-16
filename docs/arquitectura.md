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

> El SQL que se aplica vive en `supabase/migrations/` (tres archivos, en orden:
> tablas e índices → funciones y triggers → permisos, RLS y Storage). Lo que sigue
> refleja ese esquema. Si algo diverge, **gana la migración** y hay que corregir
> este documento.

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
  constraint sorteos_capacidad_valida check (tickets_vendidos between 0 and tickets_totales),
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
por esquema, sin SQL dinámico. Al final de esa migración se revoca `execute` a
`public`, `anon`, `authenticated` y `service_role`, y la sección 6 lo vuelve a
conceder solo sobre las tres RPC que el navegador necesita.

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
-- SECURITY DEFINER: permite comprar con la anon key sin conceder escritura directa
-- sobre boletos ni lectura de datos personales. El cliente no elige precio, código,
-- cantidad gratis, estado ni auditoría.
create function public.comprar_tickets(
  p_sorteo_id uuid,
  p_cantidad integer,
  p_nombre_comprador text,
  p_telefono text,
  p_tipo_documento text,
  p_numero_documento text
) returns public.boletos
language plpgsql security definer set search_path = '' as $$
declare
  v_precio integer; v_gratis integer; v_incremento bigint;
  v_max_tickets_por_compra integer; v_boleto public.boletos;
begin
  v_gratis := public.calcular_tickets_gratis(p_cantidad);  -- lanza si es null, 0 o negativa
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
    -- Distingue "superaste el tope por compra" del resto, para que el formulario
    -- pueda mostrar un mensaje accionable en vez de un "no hay cupo" genérico.
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
    p_sorteo_id, btrim(p_nombre_comprador), btrim(p_telefono), p_tipo_documento, btrim(p_numero_documento),
    p_cantidad, v_gratis, (p_cantidad::bigint * v_precio)::integer
  ) returning * into v_boleto;

  return v_boleto;
end;
$$;
```

Lo que valida antes de escribir: cantidad positiva y sin desbordar `integer`, nombre
(1–200), teléfono y documento (1–32), `tipo_documento` en la whitelist, sorteo activo,
**ventana de ventas abierta** (`fecha_inicio_ventas <= now()` y `fecha_fin_ventas` nula
o futura), **tope por compra** (`max_tickets_por_compra`) y cupo disponible contando
los gratis. Nada de esto acredita identidad ni posesión del teléfono o el documento.

**Código de error `P1001`:** se reserva para "superaste el tope por compra". El
frontend debe distinguirlo para mostrar el máximo permitido en vez del mensaje
genérico de falta de cupo.

**Reservas fantasma:** no las hay por fallo técnico. El `UPDATE` del contador y el
`INSERT` del boleto viven en la misma transacción, así que si el insert falla el
contador vuelve atrás. Lo que sí retiene cupo es un boleto que queda en `pendiente` y
nunca se paga — eso lo resuelve el TTL del pendiente #4.

### Revisión de pagos y liberación de cupo

```sql
-- El servidor decide quién y cuándo revisó; lo que mande el cliente en
-- validado_por / validado_en se descarta.
create function public.registrar_revision_boleto()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_admin uuid;
begin
  if new.estado is not distinct from old.estado then
    new.validado_por := old.validado_por;  -- sin cambio de estado no se toca la revisión
    new.validado_en := old.validado_en;
    return new;
  end if;

  if old.estado = 'rechazado' then
    raise exception 'Un boleto rechazado no puede reactivarse; debe realizarse una nueva compra';
  end if;

  if new.estado = 'pendiente' then
    new.validado_por := null;  -- volver a pendiente desde validado limpia la revisión
    new.validado_en := null;
    return new;
  end if;

  select user_id into v_admin from public.admins where user_id = (select auth.uid());

  if v_admin is not null then
    new.validado_por := 'admin:' || v_admin::text;
  elsif new.validado_por is null or char_length(btrim(new.validado_por)) = 0
    or new.validado_por is not distinct from old.validado_por then
    -- Una revisión de servicio (futuro 'ocr:nequi') debe identificarse explícitamente
    raise exception 'La revisión de servicio debe identificar al responsable';
  end if;

  new.validado_en := now();
  return new;
end;
$$;

create trigger trg_registrar_revision_boleto
  before update on public.boletos
  for each row execute function public.registrar_revision_boleto();

-- Si un admin rechaza el pago, libera los tickets reservados de vuelta al contador.
-- SECURITY DEFINER porque el admin no tiene permiso de escritura sobre tickets_vendidos.
create function public.liberar_tickets_rechazados()
returns trigger language plpgsql security definer set search_path = '' as $$
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
```

**Libera exactamente una vez.** La guarda `old.estado <> 'rechazado'` hace que repetir
el `update` a `rechazado` no descuente de nuevo, y `tickets_vendidos >= old.cantidad_total`
impide dejar el contador en negativo (si no se cumple, falla en vez de corromper el
dato). Se libera `cantidad_total`, o sea comprados **más** gratis: exactamente lo que
se reservó.

**`rechazado` es un estado terminal por diseño** — ver pendiente #5.

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

## 3. Pagos: fase manual ahora, automatizada después

La forma de pago queda en blanco por ahora — el esquema ya está preparado para no requerir migraciones cuando se implemente.

**Fase 1 (ahora):** el formulario de registro público llama a la RPC `comprar_tickets` (ver sección 2), que reserva los tickets y crea el boleto en `estado = 'pendiente'`, con `metodo_pago` y `comprobante_url` en null (no se exige comprobante todavía). Desde el panel admin se agrega una vista `AdminBoletosPage` donde el admin revisa manualmente y cambia `estado` a `validado` o `rechazado`. Quien graba `validado_por = 'admin:<user_id>'` y `validado_en = now()` es el trigger `registrar_revision_boleto`, no el panel: el cliente solo manda `estado`, y lo que enviara en esos dos campos se descarta. Si se rechaza, el trigger `liberar_tickets_rechazados` devuelve esos tickets al cupo disponible, una sola vez; el boleto queda en un estado terminal y no se puede reactivar (ver pendiente #5).

**Fase 2 (cuando se defina el pago, ej. Nequi):** se agrega el upload de comprobante en el formulario público + una Edge Function `validate-comprobante-nequi` que hace OCR, completa `metodo_pago` y `comprobante_url`, y actualiza `estado`/`validado_por = 'ocr:nequi'` automáticamente. No cambia la estructura de tablas, solo el flujo — la revisión manual puede seguir existiendo como respaldo para los casos que el OCR no logre leer.

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
      MecanicaSection.tsx        // 3 pasos + preview del pase digital
        DigitalPassPreview.tsx   // código, precio, QR, estado
      TicketsSection.tsx         // selector de cantidad + quick-picks + total
      TransparenciaSection.tsx   // stats + barra de progreso vendidos/restantes
      GanadoresSection.tsx       // Hall of fame — lista con detalle al hacer hover
      FaqSection.tsx             // acordeón de preguntas frecuentes
  store/
    useSorteoStore.ts           // Zustand — sorteo seleccionado (equivalente a Pinia)
  hooks/
    useSorteos.ts               // equivalente al composable useSorteos
    useCountdown.ts              // cuenta regresiva hasta fecha_fin_ventas
    useScrollReveal.ts           // animación de aparición al hacer scroll
  lib/
    supabase.ts
  utils/
    currency.ts
```

## 6. Perfiles: público vs admin

Dos superficies sobre el mismo repo: la web pública (registro/consulta de boletos) y un panel `/admin/*` protegido para editar sorteos y premios (precios, nombres, imágenes, fechas).

**Supuesto de partida:** un solo rol "admin" plano, sin niveles de permiso (editor vs super-admin). Si necesitas distinguir roles, se ajusta agregando una columna `rol` a la tabla `admins`.

**Auth:** Supabase Auth (email/password) + tabla de whitelist de administradores. Este diseño ya soporta **varias personas usando el panel** sin cambios: cada una tiene su propia cuenta y una fila en `admins` — la política RLS valida "¿está en `admins`?", no un usuario específico.

Como son varios editando sorteos y premios, `sorteos` y `sorteo_premios` llevan
auditoría básica (`creado_por` / `actualizado_por`). Esas columnas **las rellena un
trigger** a partir de `auth.uid()`, no el cliente — ver "Auditoría de quién creó y
modificó qué" en la sección 2.

Permisos y políticas tal como se aplican en la tercera migración:

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
grant delete on public.sorteos to authenticated;
grant insert, update, delete on public.sorteo_premios, public.ganadores to authenticated;

-- Del boleto solo se puede tocar la revisión, y el trigger igual la recalcula.
-- No hay insert ni delete desde el navegador: así no se elude la reserva de cupo.
grant update (estado, validado_por, validado_en) on public.boletos to authenticated;

grant all on public.admins, public.sorteos, public.sorteo_premios,
  public.boletos, public.ganadores to service_role;
grant all on sequence public.boletos_codigo_seq to service_role;

-- Las tres únicas funciones que el navegador puede invocar
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
| Boletos | Sin acceso | Cero filas visibles | Lee todos y cambia `estado` |
| Admins | Sin acceso | Solo su propia fila | Solo su propia fila |
| Banners | Lee | Lee | Lee, sube, reemplaza y elimina |
| Comprobantes | Sin acceso | Sin acceso | Sin acceso directo desde el navegador |

**Alta de administradores:** no se puede hacer desde la API — `admins` no tiene
política de `insert` ni grant de escritura. Hay que crear la cuenta en Supabase Auth
y agregar su `user_id` a `admins` por una vía administrativa (SQL Editor o clave de
servicio). La clave `service_role` nunca debe llegar al navegador.

**Nada de `insert` ni `delete` sobre `boletos` desde el navegador**, ni siquiera para
un admin: si necesita registrar una compra, usa la misma RPC `comprar_tickets`. Así
no hay forma de crear boletos sin reservar cupo ni de borrarlos sin devolverlo.

**Rutas y componentes nuevos:**

```
pages/
  admin/
    AdminLoginPage.tsx
    AdminDashboardPage.tsx
    AdminSorteosPage.tsx        // listado + crear/editar sorteo
    AdminPremiosPage.tsx        // CRUD de premios por sorteo
    AdminBoletosPage.tsx        // revisión manual de pagos (fase 1): aprobar/rechazar boletos
    AdminGanadoresPage.tsx      // registrar ganador de una edición (Hall of fame)
components/
  admin/
    ProtectedRoute.tsx          // valida sesión Supabase antes de renderizar /admin/*
    SorteoForm.tsx               // edicion_numero, nombre, subtitulo, descripcion, precio_boleto, tickets_totales,
                                 // max_tickets_por_compra, codigo_prefijo, fechas, color_hex, banner_url, activo
    PremioForm.tsx                // nombre, tipo (mayor/secundario), badge_label, valor_referencial, imagen (upload), orden
    GanadorForm.tsx                // nombre, ciudad, premio, foto, fecha de entrega
    ImageUploader.tsx             // sube a bucket sorteos-banners
```

`ProtectedRoute` redirige a `/admin/login` si no hay sesión activa; no necesita verificar la tabla `admins` en el cliente (eso ya lo garantiza RLS en el servidor) — solo gatea la navegación.

## 7. Diseño: "Purple Draw"

Ya lo revisé. Dos cosas importantes antes del detalle:

- **El diseño confirma el negocio:** es un sorteo temático de BTS ("Gana una Experiencia Purple", disclaimer de no afiliación con HYBE/BIGHIT/BTS en el footer) — el mismo tipo de producto que cincotreboles.com, solo que para Colombia. Todo lo demás ya calza con lo que veníamos armando.
- **El archivo exportado no es código reutilizable.** Claude Design empaqueta la página en su propio formato interno (bindings `{{ }}`, directivas `sc-if`/`sc-for`, una clase `DCLogic`) — no es React ni HTML plano para copiar. Es una referencia visual y de comportamiento; hay que traducirla a mano a los componentes de React de abajo.

**Secciones de la landing y a qué corresponden:**

| Sección del diseño | Componente | Datos que necesita |
|---|---|---|
| Header + menú fullscreen | `Header`, `MobileNav` | — (estático) |
| Hero: badges, countdown, contador de tickets | `HeroSection` | `sorteos.fecha_fin_ventas` (countdown), `tickets_totales`/`tickets_vendidos` (contador, lectura directa) |
| Premios: 1 mayor + 3 secundarios | `PremiosSection` | `sorteo_premios` filtrado por `tipo` |
| Mecánica: 3 pasos + pase digital de ejemplo | `MecanicaSection`, `DigitalPassPreview` | `boletos.codigo`, `precio_boleto` |
| Tickets: selector de cantidad + quick-picks | `TicketsSection` | `calcular_monto_total` (preview) → `comprar_tickets` (al confirmar) |
| Transparencia: stats + barra de progreso | `TransparenciaSection` | `tickets_totales` y `tickets_vendidos` — lectura directa, sin agregación |
| Ganadores (Hall of fame) | `GanadoresSection` | tabla `ganadores` |
| FAQ | `FaqSection` | estático por ahora (ver pendiente #2) |
| Footer | `Footer` | — (estático) |

**Un detalle a resolver con el modelo de "4+1 gratis":** los quick-picks del diseño muestran "3 tickets · $15.000 COP" y "5 tickets · $25.000 COP" — el monto sí coincide con `cantidad_comprada × precio_boleto` (los gratis no cambian el precio, solo la cantidad de tickets recibidos), pero el diseño no comunica el ticket gratis en el botón de 5. Sugerencia: agregar algo como "5 tickets + 1 gratis" en ese botón y mostrar `tickets_gratis` junto al total, para que se entienda la promoción en el momento de comprar.

**Campos nuevos que salieron de revisar el diseño** (ya aplicados en la sección 2): `edicion_numero`, `tickets_totales` y `tickets_vendidos` en `sorteos`; `tipo`/`badge_label`/`valor_referencial` en `sorteo_premios` (reemplazando `es_premio_principal`); `codigo` único por boleto (el "pase digital", generado por trigger); tabla `ganadores` nueva para el Hall of fame.

## 8. Escalabilidad

Lo más importante primero — el punto donde un sitio de sorteos realmente se rompe bajo carga es la compra concurrente de tickets, así que el diseño de datos ya lo prioriza:

1. **Sin sobreventa bajo concurrencia.** `comprar_tickets` (sección 2) reserva con un único `UPDATE ... WHERE tickets_vendidos + incremento <= tickets_totales`. Postgres resuelve esto con un lock de fila breve e implícito — no con un `SELECT FOR UPDATE` de transacción larga ni con un `SUM()` sobre toda la tabla `boletos` en cada compra, que se pondría cada vez más lento a medida que crece la tabla. El lock es por fila de `sorteos`, así que ediciones distintas no se bloquean entre sí; solo se serializan las compras de la *misma* edición, que es exactamente donde se necesita la protección.
2. **Contador de lectura barata.** `tickets_vendidos` es denormalizado — el Hero y la barra de progreso lo leen directo, sin agregación. Se mantiene consistente con el trigger `liberar_tickets_rechazados`, que lo decrementa si un admin rechaza un pago.
3. **Índices** en las columnas por las que se filtra seguido: `boletos.sorteo_id`, `boletos.estado` (para `AdminBoletosPage`), `sorteo_id` en `sorteo_premios`/`ganadores`, y `premio_id`/`boleto_id` en `ganadores` para resolver el Hall of fame sin recorrer la tabla. `boletos.numero_documento` también está indexado, pero hoy **no lo usa nadie**: la consulta pública por documento está cerrada hasta decidir el pendiente #6.
4. **Code-splitting del bundle:** cargar `/admin/*` con `React.lazy` + `Suspense` en vez de en el bundle principal — los visitantes públicos (que son la mayoría del tráfico) no descargan el código del panel admin. Como `@supabase/supabase-js` hoy solo entra por esa rama, también queda fuera del bundle público; eso cambiará en cuanto la landing consuma datos.
5. **Cacheo:** TanStack Query ya evita refetchear lo mismo en cada render; para las imágenes de premios/banners (que se comparten mucho por WhatsApp), usar las transformaciones de Supabase Storage o un CDN para servir tamaños optimizados en vez de la imagen original completa.
6. **Protección contra abuso, no solo contra tráfico legítimo:** un sorteo con tickets gratis por volumen es un objetivo típico de bots/scripts. Ya está aplicado el tope por compra (`sorteos.max_tickets_por_compra`, default 50), que impide que una sola llamada a la RPC se lleve todo el cupo restante. Siguen abiertos el captcha (hCaptcha/Turnstile) y la `idempotency_key` por envío para que un doble clic o un reintento de red no genere dos boletos — ver pendiente #3. Ojo: como `comprar_tickets` se puede invocar directamente con la anon key, un captcha puesto solo en el formulario se elude llamando la RPC a mano; tiene que validarse del lado del servidor.
7. **A futuro, si el tráfico crece mucho:** Supabase Pro ofrece réplicas de lectura y mayor cómputo — no hace falta diseñarlo ahora, pero la separación de la lectura pública (vía RLS de solo-lectura) del resto ya deja el camino libre para eso sin cambios de esquema.

## 9. Pendientes

1. **Capturas reales de comprobantes Nequi** — sigue pendiente, sin fecha aún.
2. **Términos y condiciones / Política de privacidad** del footer — ¿páginas reales o placeholder por ahora?
3. **Captcha + idempotencia en el registro público** — el tope por compra ya está en el esquema; falta decidir si el captcha y la `idempotency_key` entran desde el inicio o cuando haya tráfico real. La validación del captcha tiene que ocurrir en el servidor, no solo en el formulario.
4. **TTL de boletos pendientes** — decidido, va en un PR aparte. Hoy un boleto que queda en `pendiente` retiene su cupo indefinidamente hasta que un admin lo rechace a mano, así que una tanda de compras abandonadas puede dejar un sorteo sin cupo disponible aunque nadie haya pagado. El TTL vence esas reservas y devuelve el cupo automáticamente.
5. **`rechazado` es terminal por diseño.** Un boleto rechazado no se puede reactivar: su cupo ya volvió al contador y puede haberlo tomado otra persona, así que reactivarlo permitiría sobreventa. La red de seguridad contra un rechazo por error del admin va en la UI (`AdminBoletosPage`, con confirmación explícita antes de rechazar), **no en el esquema**. Si el rechazo fue un error, el camino es una compra nueva sujeta a disponibilidad.
6. **`TicketLookupPage` no tiene camino de consulta todavía.** Buscar solo por número de documento no demuestra identidad y permite enumerar documentos, así que no se expone ningún endpoint público de búsqueda —ni como `select` ni como RPC— hasta decidir el mecanismo: un OTP al teléfono registrado (con límites por IP y destinatario, caducidad corta y respuesta genérica exista o no el documento), o un token de alta entropía entregado al comprar, guardado solo como hash y revocable. No se debe reutilizar el código `PD-00001`, el documento ni el UUID del boleto como credencial. Mientras tanto la ruta `/consulta` queda sin implementar y el índice `idx_boletos_numero_documento` no tiene consumidor.
7. **`estado`, `tipo_documento` y `tipo` salen como `string` en los tipos generados**, no como uniones: en la BD son CHECK constraints, no enums de Postgres, así que `supabase gen types` no puede estrecharlos y `Constants.public.Enums` viene vacío. Hay que decidir entre declarar las uniones a mano en el cliente (rápido, pero se desincroniza del esquema sin avisar) o convertirlos a enums de Postgres en una migración (los tipos generados quedan estrechos y sincronizados, a cambio de que agregar un valor nuevo sea una migración).

## 10. Setup local

Requiere Docker corriendo (lo usa `supabase start`) y pnpm.

```bash
pnpm install          # incluye el CLI de Supabase como devDependency
pnpm supabase start   # levanta Postgres, Auth, Storage y Studio en local
pnpm supabase db reset  # aplica las 3 migraciones y carga el seed de desarrollo
pnpm types            # regenera src/lib/database.types.ts desde la base local
pnpm dev
```

`db reset` carga el seed solo: `supabase/config.toml` trae `[db.seed]` con
`sql_paths = ["./seeds/desarrollo.sql"]`. Ese seed crea un sorteo activo (5000 COP,
5000 tickets) con un premio mayor y tres secundarios, con UUID fijos para que
repetirlo no duplique filas. **Es solo para desarrollo**, está fuera de `migrations/`
y no crea administradores ni compradores.

`supabase start` imprime la `API URL` y la `anon key` del entorno local: van en `.env`
(copiado de `.env.example`) como `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Sin
esas dos variables la app no arranca — `src/lib/supabase.ts` falla a propósito con un
mensaje explícito en vez de morir más adelante con un error opaco. Ojo: Vite las
**incrusta en tiempo de build**, así que también tienen que estar presentes al correr
`pnpm build` (en CI incluido), no solo en ejecución.

Para crear un admin en local: registra el usuario en Studio (Authentication) y luego,
desde el SQL Editor, `insert into public.admins (user_id, nombre) values ('<uuid>', 'Tu nombre');`.