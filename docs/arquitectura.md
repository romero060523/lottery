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

```sql
-- Sorteos activos
create table sorteos (
  id uuid primary key default gen_random_uuid(),
  edicion_numero int not null, -- 01, 02, 03... (se muestra en Ganadores y en el código de ticket)
  nombre text not null,
  subtitulo text,
  descripcion text,
  banner_url text,
  color_hex text,
  precio_boleto integer not null, -- COP, entero, sin decimales (ej. 5000)
  tickets_totales int not null, -- ej. 5000 — para la barra de progreso "vendidos/restantes"
  tickets_vendidos int not null default 0, -- contador denormalizado, se actualiza atómicamente en cada compra (ver sección 8)
  codigo_prefijo text not null default 'PD', -- prefijo del código de ticket, ej. "PD-48392"
  fecha_inicio_ventas timestamptz not null default now(),
  fecha_fin_ventas timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Premios por sorteo (el diseño distingue un premio mayor de varios secundarios)
create table sorteo_premios (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references sorteos(id) on delete cascade,
  nombre text not null,
  tipo text not null default 'secundario' check (tipo in ('mayor','secundario')),
  badge_label text, -- etiqueta mostrada sobre la foto: "Premio mayor", "Top pick", "Bonus"
  valor_referencial integer, -- COP, ej. 8500000
  imagen_url text,
  orden int not null default 0
);

-- Registros de boletos comprados
create table boletos (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references sorteos(id),
  codigo text unique, -- pase digital, ej. "PD-48392" — lo asigna el trigger de abajo
  nombre_comprador text not null,
  telefono text not null,
  tipo_documento text not null check (tipo_documento in ('cedula','pasaporte')),
  numero_documento text not null,
  cantidad_comprada int not null,
  cantidad_gratis int not null default 0,
  cantidad_total int generated always as (cantidad_comprada + cantidad_gratis) stored,
  monto_total integer not null, -- COP
  metodo_pago text, -- null mientras no se defina la forma de pago; luego 'nequi', etc.
  comprobante_url text, -- null en fase manual, se llena cuando exista upload de comprobante
  estado text not null default 'pendiente' check (estado in ('pendiente','validado','rechazado')),
  validado_por text, -- 'admin:<user_id>' en revisión manual, 'ocr:nequi' cuando se automatice
  validado_en timestamptz,
  created_at timestamptz not null default now()
);

create index idx_boletos_sorteo_id on boletos(sorteo_id);
create index idx_boletos_estado on boletos(estado);
create index idx_boletos_numero_documento on boletos(numero_documento); -- para TicketLookupPage
create index idx_sorteo_premios_sorteo_id on sorteo_premios(sorteo_id);
create index idx_ganadores_sorteo_id on ganadores(sorteo_id);

-- Genera el código del pase digital usando el prefijo del sorteo (ej. "PD-00001")
create sequence boletos_codigo_seq;

create or replace function generar_codigo_boleto()
returns trigger language plpgsql as $$
declare
  prefijo text;
begin
  select codigo_prefijo into prefijo from sorteos where id = new.sorteo_id;
  new.codigo := coalesce(prefijo, 'PD') || '-' || lpad(nextval('boletos_codigo_seq')::text, 5, '0');
  return new;
end;
$$;

create trigger trg_generar_codigo_boleto
  before insert on boletos
  for each row execute function generar_codigo_boleto();

-- Compra atómica: reserva los tickets con un solo UPDATE con guarda (evita sobreventa
-- bajo concurrencia sin necesitar un lock explícito de fila ni un SUM agregado en boletos)
create or replace function comprar_tickets(
  p_sorteo_id uuid,
  p_cantidad int,
  p_nombre_comprador text,
  p_telefono text,
  p_tipo_documento text,
  p_numero_documento text
) returns boletos
language plpgsql as $$
declare
  v_precio int;
  v_gratis int;
  v_incremento int;
  v_boleto boletos;
begin
  v_gratis := calcular_tickets_gratis(p_cantidad);
  v_incremento := p_cantidad + v_gratis;

  update sorteos
    set tickets_vendidos = tickets_vendidos + v_incremento
    where id = p_sorteo_id
      and activo = true
      and tickets_vendidos + v_incremento <= tickets_totales
    returning precio_boleto into v_precio;

  if v_precio is null then
    raise exception 'No hay tickets disponibles o el sorteo no está activo';
  end if;

  insert into boletos (sorteo_id, nombre_comprador, telefono, tipo_documento, numero_documento,
                        cantidad_comprada, cantidad_gratis, monto_total)
  values (p_sorteo_id, p_nombre_comprador, p_telefono, p_tipo_documento, p_numero_documento,
          p_cantidad, v_gratis, p_cantidad * v_precio)
  returning * into v_boleto;

  return v_boleto;
end;
$$;

-- Si un admin rechaza el pago, libera los tickets reservados de vuelta al contador
create or replace function liberar_tickets_rechazados()
returns trigger language plpgsql as $$
begin
  if new.estado = 'rechazado' and old.estado != 'rechazado' then
    update sorteos
      set tickets_vendidos = tickets_vendidos - old.cantidad_total
      where id = new.sorteo_id;
  end if;
  return new;
end;
$$;

create trigger trg_liberar_tickets_rechazados
  after update on boletos
  for each row execute function liberar_tickets_rechazados();

-- Hall of fame: ganadores históricos que se muestran en la landing (persisten aunque el sorteo cierre)
create table ganadores (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references sorteos(id),
  premio_id uuid references sorteo_premios(id),
  boleto_id uuid references boletos(id),
  nombre_ganador text not null,
  ciudad text,
  fecha_entrega date,
  foto_url text,
  created_at timestamptz not null default now()
);

-- Fórmula de tickets gratis: 4 comprados = 1 gratis, y así sucesivamente
create or replace function calcular_tickets_gratis(cantidad int)
returns int language sql immutable as $$
  select floor(cantidad::numeric / 4)::int;
$$;

-- RPC de cálculo total (equivalente a calcular_monto_total en Premios Lorenzo)
create or replace function calcular_monto_total(p_cantidad int, p_precio_boleto int)
returns table(cantidad_comprada int, tickets_gratis int, cantidad_total int, monto_total int)
language sql immutable as $$
  select
    p_cantidad,
    calcular_tickets_gratis(p_cantidad),
    p_cantidad + calcular_tickets_gratis(p_cantidad),
    p_cantidad * p_precio_boleto;
$$;
```

**Buckets de Storage:** `sorteos-banners` (público, igual que en Premios Lorenzo) y `comprobantes-pago` (privado, solo accesible vía Edge Function).

## 3. Pagos: fase manual ahora, automatizada después

La forma de pago queda en blanco por ahora — el esquema ya está preparado para no requerir migraciones cuando se implemente.

**Fase 1 (ahora):** el formulario de registro público llama a la RPC `comprar_tickets` (ver sección 9), que reserva los tickets y crea el boleto en `estado = 'pendiente'`, con `metodo_pago` y `comprobante_url` en null (no se exige comprobante todavía). Desde el panel admin se agrega una vista `AdminBoletosPage` donde el admin revisa manualmente y cambia `estado` a `validado` o `rechazado`, dejando registro en `validado_por = 'admin:<user_id>'` y `validado_en = now()`. Si se rechaza, el trigger `liberar_tickets_rechazados` libera esos tickets automáticamente para que vuelvan a estar disponibles.

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

Como van a ser varios editando sorteos y premios, conviene agregar auditoría básica (quién creó/modificó qué):

```sql
alter table sorteos
  add column creado_por uuid references admins(user_id),
  add column actualizado_por uuid references admins(user_id);

alter table sorteo_premios
  add column creado_por uuid references admins(user_id),
  add column actualizado_por uuid references admins(user_id);
```

```sql
create table admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  created_at timestamptz not null default now()
);

alter table sorteos enable row level security;
alter table sorteo_premios enable row level security;

-- Lectura pública solo de sorteos activos
create policy "sorteos_select_publico" on sorteos
  for select using (activo = true);

-- Admin: control total
create policy "sorteos_admin_all" on sorteos
  for all using (exists (select 1 from admins where user_id = auth.uid()))
  with check (exists (select 1 from admins where user_id = auth.uid()));

create policy "premios_select_publico" on sorteo_premios
  for select using (true);

create policy "premios_admin_all" on sorteo_premios
  for all using (exists (select 1 from admins where user_id = auth.uid()))
  with check (exists (select 1 from admins where user_id = auth.uid()));

alter table ganadores enable row level security;

create policy "ganadores_select_publico" on ganadores
  for select using (true);

create policy "ganadores_admin_all" on ganadores
  for all using (exists (select 1 from admins where user_id = auth.uid()))
  with check (exists (select 1 from admins where user_id = auth.uid()));

-- Storage: banners públicos para lectura, solo admin puede subir
create policy "banners_select_publico" on storage.objects
  for select using (bucket_id = 'sorteos-banners');

create policy "banners_admin_write" on storage.objects
  for insert with check (
    bucket_id = 'sorteos-banners'
    and exists (select 1 from admins where user_id = auth.uid())
  );
```

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
    SorteoForm.tsx               // nombre, subtitulo, descripcion, precio_boleto, tickets_totales, fechas, color_hex, activo
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
3. **Índices** en las columnas por las que se filtra seguido: `boletos.sorteo_id`, `boletos.estado` (para `AdminBoletosPage`), `boletos.numero_documento` (para `TicketLookupPage`), y `sorteo_id` en `sorteo_premios`/`ganadores`.
4. **Code-splitting del bundle:** cargar `/admin/*` con `React.lazy` + `Suspense` en vez de en el bundle principal — los visitantes públicos (que son la mayoría del tráfico) no descargan el código del panel admin.
5. **Cacheo:** TanStack Query ya evita refetchear lo mismo en cada render; para las imágenes de premios/banners (que se comparten mucho por WhatsApp), usar las transformaciones de Supabase Storage o un CDN para servir tamaños optimizados en vez de la imagen original completa.
6. **Protección contra abuso, no solo contra tráfico legítimo:** un sorteo con tickets gratis por volumen es un objetivo típico de bots/scripts. Vale la pena un captcha (hCaptcha/Turnstile) en el formulario público y una `idempotency_key` única por envío para que un doble clic o un reintento de red no genere dos boletos. Lo dejo como pendiente a decidir contigo, no lo asumo por mi cuenta.
7. **A futuro, si el tráfico crece mucho:** Supabase Pro ofrece réplicas de lectura y mayor cómputo — no hace falta diseñarlo ahora, pero la separación de la lectura pública (vía RLS de solo-lectura) del resto ya deja el camino libre para eso sin cambios de esquema.

## 9. Pendientes

1. **Capturas reales de comprobantes Nequi** — sigue pendiente, sin fecha aún.
2. **Términos y condiciones / Política de privacidad** del footer — ¿páginas reales o placeholder por ahora?
3. **Captcha + idempotencia en el registro público** — ¿lo implementamos desde el inicio o se deja para cuando haya tráfico real?