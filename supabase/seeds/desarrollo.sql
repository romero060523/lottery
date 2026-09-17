-- SEED EXCLUSIVO DE DESARROLLO. NO ES UNA MIGRACIÓN DE PRODUCCIÓN.
-- Ejecutar manualmente solo en una base de desarrollo, después de las migraciones.
begin;

insert into public.sorteos (
  id, edicion_numero, nombre, subtitulo, descripcion, color_hex,
  precio_boleto, tickets_totales, codigo_prefijo, fecha_fin_ventas, fecha_sorteo, activo
) values (
  'd0000000-0000-4000-8000-000000000001',
  1,
  'Experiencia Purple — desarrollo',
  'Un sorteo de ejemplo para la comunidad',
  'Datos ficticios para desarrollo. Por cada cuatro tickets comprados se entrega uno gratis.',
  '#7C3AED',
  5000,
  5000,
  'PD',
  now() + interval '8 days',
  now() + interval '9 days',
  true
) on conflict (id) do nothing;

insert into public.sorteo_premios (
  id, sorteo_id, nombre, tipo, badge_label, valor_referencial, orden
) values
  (
    'd0000000-0000-4000-8000-000000000011',
    'd0000000-0000-4000-8000-000000000001',
    'Experiencia Purple de ejemplo', 'mayor', 'Premio mayor', 8500000, 0
  ),
  (
    'd0000000-0000-4000-8000-000000000012',
    'd0000000-0000-4000-8000-000000000001',
    'Colección de álbumes de ejemplo', 'secundario', 'Colección especial', 500000, 1
  ),
  (
    'd0000000-0000-4000-8000-000000000013',
    'd0000000-0000-4000-8000-000000000001',
    'Kit de accesorios de ejemplo', 'secundario', 'Kit de regalo', 300000, 2
  ),
  (
    'd0000000-0000-4000-8000-000000000014',
    'd0000000-0000-4000-8000-000000000001',
    'Bono de tienda de ejemplo', 'secundario', 'Bono especial', 200000, 3
  )
on conflict (id) do nothing;

commit;
