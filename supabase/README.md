# Esquema inicial de Supabase

Implementa las secciones 2 y 6 de `docs/arquitectura.md`. Andy aplica y verifica
las migraciones; esta entrega no ejecuta SQL contra ninguna base de datos.
Se presupone un proyecto Supabase con `auth`, `storage` y los roles `anon`,
`authenticated` y `service_role`. Las migraciones deben pertenecer al rol
administrativo de migraciones, que puede acceder a las tablas sin RLS.

## Archivos y orden

1. `migrations/20260915000100_crear_tablas_e_indices.sql`: las cinco tablas,
   restricciones, índices, secuencia y cierre inicial mediante RLS y permisos.
2. `migrations/20260915000200_crear_funciones_y_triggers.sql`: cálculos, compra,
   códigos, auditoría y liberación de reservas rechazadas.
3. `migrations/20260915000300_configurar_rls_y_storage.sql`: permisos explícitos,
   políticas y los dos buckets de Storage.

`seeds/desarrollo.sql` está fuera de `migrations/` y no se ejecuta automáticamente.
Es exclusivamente para desarrollo: crea un sorteo activo con precio de **5000 COP**,
capacidad de **5000 tickets** y cuatro premios (uno mayor y tres secundarios).
Los UUID fijos permiten repetirlo sin duplicar registros ni sobrescribir cambios.
No crea administradores, compradores ni comprobantes. Todos los montos son enteros.

## Compra pública y SECURITY DEFINER

El navegador puede ejecutar `comprar_tickets` con la anon key. La función es
`SECURITY DEFINER` porque reserva cupo y crea un boleto aunque ese llamador no
tenga permisos de escritura sobre las tablas. Usa `search_path = ''`, referencias
calificadas por esquema y ninguna sentencia SQL dinámica. Se revoca la ejecución
implícita de `PUBLIC` y solo se habilitan las tres RPC de compra/cálculo para
`anon`, `authenticated` y el servicio. Los triggers no se exponen como RPC.

Antes de escribir se comprueban cantidad positiva, valores nulos, tipo de documento,
longitudes de nombre (1–200), teléfono y documento (1–32), sorteo activo, ventana
de ventas, cupo y rango de enteros. Los textos se recortan en los extremos; estas
validaciones **no acreditan identidad ni propiedad del teléfono/documento**.
El precio se lee del sorteo dentro del mismo `UPDATE` que reserva cupo; los gratis
se calculan como `cantidad / 4`. El cliente no puede elegir monto, gratis, código,
estado ni auditoría. `calcular_monto_total` es solo una previsualización: su precio
de entrada nunca determina el precio de una compra.

La reserva usa un `UPDATE` condicionado por capacidad, incluidos los tickets gratis.
La creación del boleto pertenece a la misma transacción: si falla, la reserva se
revierte. Los productos y sumas intermedios usan `bigint` para detectar desbordamientos;
las columnas monetarias y los resultados continúan siendo `integer` en COP.
La RPC devuelve únicamente el boleto que acaba de crear con los datos recibidos,
sin consultar compras anteriores del documento. El código secuencial conserva
al menos cinco dígitos sin truncarse al superar `99999`; no es un secreto de acceso.

Esta protección de privilegios no sustituye controles contra abuso. Captcha,
idempotencia, límites de reservas y caducidad de pendientes siguen pendientes de
decisión, como anticipa la arquitectura. Al permitir llamada directa con anon,
un captcha solamente en el formulario podría eludirse.

## Datos personales y administración

| Recurso | Público (`anon`) | Sesión sin admin | Admin de la whitelist |
| --- | --- | --- | --- |
| Sorteos | Lee activos | Lee activos | Lee todos y administra configuración |
| Premios y ganadores | Lee | Lee | Lee, crea, edita y elimina |
| Boletos | Sin SELECT ni escritura directa | Sin filas visibles ni edición | Lee todos y revisa estados |
| Admins | Sin acceso | Consulta únicamente su propia pertenencia | Consulta únicamente su propia pertenencia |
| Banners | Lee | Lee | Lee, sube, reemplaza y elimina |
| Comprobantes | Sin acceso | Sin acceso | Sin acceso directo desde el navegador |

`boletos` contiene nombre, teléfono y documento. Se habilita RLS, se revocan
los permisos públicos y **no se crea ninguna política de lectura pública**, ni
siquiera filtrada por documento. `boletos_select_admin` permite leer todas las
filas a usuarios autenticados presentes en `admins`, cubriendo `AdminBoletosPage`.
La política de actualización exige la misma pertenencia y los permisos de columna
solo admiten `estado`, `validado_por` y `validado_en`. No hay INSERT ni DELETE
directo desde el navegador: así tampoco se elude o desajusta la reserva de cupos.
Los administradores utilizan la misma RPC si necesitan registrar una compra.

Los usuarios autenticados no pueden darse de alta en `admins` ni modificarla.
Andy debe crear las cuentas en Auth y agregar sus UUID a la whitelist por una vía
administrativa confiable. Su política de lectura compara `user_id` con `auth.uid()`
sin consultar recursivamente `admins`. El rol de servicio conserva acceso para
operaciones de backend; su clave nunca debe llegar al navegador.

La auditoría de sorteos/premios asigna `creado_por` y `actualizado_por` desde
`auth.uid()` si pertenece a `admins`; conserva el creador en las ediciones. Las
operaciones administrativas sin usuario (incluido el seed) dejan autoría nula.
Una reserva o liberación que solo cambia el contador conserva la última autoría
de configuración. El formulario de sorteos solo puede escribir campos de
configuración, no `tickets_vendidos` ni la auditoría.

La revisión manual puede enviar solo `{ estado: 'validado' }` o
`{ estado: 'rechazado' }`; el trigger registra `admin:<auth.uid()>` y la fecha
del servidor, reemplazando cualquier autor/fecha suministrados por el cliente.
Sin cambio de estado conserva la revisión previa; volver a `pendiente` desde
`validado` limpia esos campos. El servicio puede identificar revisiones futuras,
por ejemplo con `ocr:nequi`, sin habilitar acceso público a los comprobantes.

Rechazar libera una sola vez los tickets comprados y gratis. **Rechazado es un
estado terminal**: no se permite reactivarlo porque su cupo ya fue liberado; se
debe crear una compra nueva, sujeta nuevamente a disponibilidad. Repetir el
rechazo no descuenta cupo ni cambia su auditoría. La función de liberación también
es `SECURITY DEFINER`, con búsqueda vacía y sin EXECUTE para clientes, porque el
admin no puede escribir directamente el contador. Los borrados de sorteos con
boletos y las referencias históricas quedan protegidos por las claves foráneas.

Se conserva la lectura pública de todos los premios y del historial de ganadores
indicada por la arquitectura. `ganadores.boleto_id` no concede acceso al boleto
relacionado: las consultas anidadas siguen sujetas a los permisos y RLS de boletos.
El bucket `comprobantes-pago` es privado y no recibe políticas de navegador;
su acceso futuro corresponde a una Edge Function con credenciales de servicio.

## Decisión pendiente para Andy: TicketLookupPage

Buscar solamente por documento no demuestra identidad. Un `SELECT` público con
`.eq('numero_documento', valor)` permite enumerar documentos; mover ese mismo
filtro a una RPC tampoco resuelve el problema. Esta entrega deja esa consulta
cerrada, sin endpoint público de búsqueda.

**Propuesta para decidir con Andy antes de implementar la consulta:** una Edge
Function que verifique un OTP enviado al teléfono registrado, con límites por
IP y destinatario, caducidad corta, intentos limitados y respuesta genérica tanto
si el documento existe como si no. Solo tras verificar la posesión debe emitir una
autorización breve, limitada al documento y al teléfono verificados, y devolver
los campos mínimos del pase (código, sorteo, cantidades y estado). Verificar un
teléfono no debe revelar otras compras del mismo documento con teléfonos distintos.
Evitar exponer nombres completos, teléfono, documento o comprobantes en la respuesta.

Como alternativa para recuperar **un pase específico**, Andy puede optar por un
token aleatorio de alta entropía entregado al comprar, almacenado solo como hash,
revocable y con caducidad; no debe reutilizarse el código secuencial `PD-00001`,
el documento ni el UUID público de un boleto como credencial. Esa alternativa
requiere definir entrega, almacenamiento seguro, recuperación ante pérdida y una
migración posterior. No se implementan tokens ni OTP hasta que Andy elija el flujo.

## Verificación pendiente de aplicación por Andy

Esta entrega se verifica estáticamente, sin aplicar migraciones ni seed, ni
conectarse al proyecto remoto. Después de aplicarlas en una base de desarrollo:

- Comprobar 4 comprados → 1 gratis, total 5 y monto 20000 COP con precio 5000;
  rechazar nulos, negativos, cero, texto vacío, documento inválido y desbordamientos.
- Comprar con anon; confirmar que devuelve solo el boleto recién creado y que
  los SELECT directos a boletos y admins están denegados. Una sesión sin admin
  no debe leer boletos, revisar pagos, editar sorteos ni ascenderse a admin.
- Probar sorteos inactivos, futuros, vencidos y dos compras simultáneas sobre el
  último cupo; no debe haber sobreventa ni reservas sin su boleto correspondiente.
- Simular un fallo al insertar el boleto y confirmar que revierte el contador;
  la secuencia puede dejar huecos, que son normales y no representan cupo vendido.
- Revisar como admin: autor/fecha reales, cantidades inmutables, liberación exacta
  al rechazar, segundo rechazo sin efecto y reactivación denegada. Confirmar que
  reservas anónimas no borran la autoría de configuración de sorteos.
- Verificar CRUD administrativo, auditoría con dos admins distintos y permisos de
  Storage: banners legibles públicamente, escritura solo admin y comprobantes cerrados.
- Ejecutar el seed solo en desarrollo y comprobar el sorteo activo, sus cuatro
  premios y los valores 5000; repetirlo y comprobar que no duplica registros.

Referencias para las decisiones de permisos: [funciones de Supabase](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)
y [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
