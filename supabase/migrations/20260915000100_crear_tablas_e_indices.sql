begin;

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  created_at timestamptz not null default now()
);

create table public.sorteos (
  id uuid primary key default gen_random_uuid(),
  edicion_numero integer not null check (edicion_numero > 0),
  nombre text not null check (char_length(btrim(nombre)) > 0),
  subtitulo text,
  descripcion text,
  banner_url text,
  color_hex text,
  precio_boleto integer not null check (precio_boleto > 0),
  tickets_totales integer not null check (tickets_totales > 0),
  tickets_vendidos integer not null default 0,
  codigo_prefijo text not null default 'PD' check (char_length(btrim(codigo_prefijo)) between 1 and 20),
  fecha_inicio_ventas timestamptz not null default now(),
  fecha_fin_ventas timestamptz,
  activo boolean not null default true,
  creado_por uuid references public.admins(user_id),
  actualizado_por uuid references public.admins(user_id),
  created_at timestamptz not null default now(),
  constraint sorteos_capacidad_valida check (tickets_vendidos between 0 and tickets_totales),
  constraint sorteos_fechas_validas check (fecha_fin_ventas is null or fecha_fin_ventas > fecha_inicio_ventas)
);

create table public.sorteo_premios (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references public.sorteos(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) > 0),
  tipo text not null default 'secundario' check (tipo in ('mayor', 'secundario')),
  badge_label text,
  valor_referencial integer check (valor_referencial >= 0),
  imagen_url text,
  orden integer not null default 0 check (orden >= 0),
  creado_por uuid references public.admins(user_id),
  actualizado_por uuid references public.admins(user_id)
);

create table public.boletos (
  id uuid primary key default gen_random_uuid(),
  sorteo_id uuid not null references public.sorteos(id),
  codigo text not null unique,
  nombre_comprador text not null check (char_length(btrim(nombre_comprador)) between 1 and 200),
  telefono text not null check (char_length(btrim(telefono)) between 1 and 32),
  tipo_documento text not null check (tipo_documento in ('cedula', 'pasaporte')),
  numero_documento text not null check (char_length(btrim(numero_documento)) between 1 and 32),
  cantidad_comprada integer not null check (cantidad_comprada > 0),
  cantidad_gratis integer not null default 0 check (cantidad_gratis >= 0),
  cantidad_total integer generated always as (cantidad_comprada + cantidad_gratis) stored,
  monto_total integer not null check (monto_total > 0),
  metodo_pago text,
  comprobante_url text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'validado', 'rechazado')),
  validado_por text,
  validado_en timestamptz,
  created_at timestamptz not null default now(),
  constraint boletos_revision_consistente check (
    (estado = 'pendiente' and validado_por is null and validado_en is null)
    or (estado in ('validado', 'rechazado') and validado_por is not null
      and char_length(btrim(validado_por)) > 0 and validado_en is not null)
  )
);

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
create index idx_boletos_estado on public.boletos(estado);
create index idx_boletos_numero_documento on public.boletos(numero_documento);
create index idx_sorteo_premios_sorteo_id on public.sorteo_premios(sorteo_id);
create index idx_ganadores_sorteo_id on public.ganadores(sorteo_id);
create index idx_ganadores_premio_id on public.ganadores(premio_id);
create index idx_ganadores_boleto_id on public.ganadores(boleto_id);

create sequence public.boletos_codigo_seq as bigint no cycle;

-- Las tablas quedan cerradas desde su creación; las políticas se agregan al final.
alter table public.admins enable row level security;
alter table public.sorteos enable row level security;
alter table public.sorteo_premios enable row level security;
alter table public.boletos enable row level security;
alter table public.ganadores enable row level security;

revoke all on table public.admins, public.sorteos, public.sorteo_premios,
  public.boletos, public.ganadores from public, anon, authenticated;
revoke all on sequence public.boletos_codigo_seq from public, anon, authenticated;

commit;
