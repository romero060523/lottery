begin;

-- Fecha en que se juega el sorteo; la landing la muestra con su cuenta regresiva.
-- Nullable para no invalidar las ediciones existentes.
alter table public.sorteos add column fecha_sorteo timestamptz;

alter table public.sorteos add constraint sorteos_fecha_sorteo_valida check (
  fecha_sorteo is null
  or (fecha_sorteo > fecha_inicio_ventas and (fecha_fin_ventas is null or fecha_sorteo >= fecha_fin_ventas))
);

-- Los grants por columna no incluyen columnas nuevas: el admin necesita poder escribirla.
grant insert (fecha_sorteo) on public.sorteos to authenticated;
grant update (fecha_sorteo) on public.sorteos to authenticated;

commit;
