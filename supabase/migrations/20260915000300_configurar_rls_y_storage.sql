begin;

grant usage on schema public to anon, authenticated, service_role;

grant select on public.sorteos, public.sorteo_premios, public.ganadores to anon, authenticated;
grant select on public.admins, public.boletos to authenticated;

-- El contador y la auditoría se administran en el servidor, no desde el formulario.
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

-- Se admiten los campos de revisión del contrato original; el trigger los recalcula.
grant update (estado, validado_por, validado_en) on public.boletos to authenticated;

grant all on public.admins, public.sorteos, public.sorteo_premios,
  public.boletos, public.ganadores to service_role;
grant all on sequence public.boletos_codigo_seq to service_role;

grant execute on function public.calcular_tickets_gratis(integer),
  public.calcular_monto_total(integer, integer),
  public.comprar_tickets(uuid, integer, text, text, text, text)
  to anon, authenticated, service_role;

-- Cada usuario solo consulta su pertenencia. No hay altas ni cambios desde la API.
-- No consulta admins dentro de su propia política, para evitar recursión RLS.
create policy admins_select_propio on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy sorteos_select_publico on public.sorteos
  for select to anon, authenticated
  using (activo = true);

create policy sorteos_admin_all on public.sorteos
  for all to authenticated
  using (exists (select 1 from public.admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins where user_id = (select auth.uid())));

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

-- Los datos personales no tienen política ni permiso SELECT para anon.
-- Una sesión autenticada común tampoco satisface estas políticas de administrador.
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

-- comprobantes-pago no tiene políticas para navegador; queda reservado al servicio.

commit;
