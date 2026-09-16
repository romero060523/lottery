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
4. `migrations/20260916000100_agregar_caducidad_pendientes.sql`: TTL configurable,
   motivo de rechazo, protección de revisión concurrente y función de caducidad.
5. `migrations/20260916000200_programar_caducidad_pendientes.sql`: extensión
   `pg_cron` y ejecución programada cada cinco minutos.

`seeds/desarrollo.sql` está fuera de `migrations/` y no se ejecuta automáticamente.
Es exclusivamente para desarrollo: crea un sorteo activo con precio de **5000 COP**,
capacidad de **5000 tickets** y cuatro premios (uno mayor y tres secundarios).
El tope por compra usa el valor predeterminado de **50 tickets comprados**.
Los UUID fijos permiten repetirlo sin duplicar registros ni sobrescribir cambios.
No crea administradores, compradores ni comprobantes. Todos los montos son enteros.
`sorteos.edicion_numero` es único: no pueden registrarse dos sorteos de la misma edición.

## Compra pública y SECURITY DEFINER

El navegador puede ejecutar `comprar_tickets` con la anon key. La función es
`SECURITY DEFINER` porque reserva cupo y crea un boleto aunque ese llamador no
tenga permisos de escritura sobre las tablas. Usa `search_path = ''`, referencias
calificadas por esquema y ninguna sentencia SQL dinámica. Se revoca la ejecución
implícita de `PUBLIC` y solo se habilitan las tres RPC de compra/cálculo para
`anon`, `authenticated` y el servicio. Los triggers no se exponen como RPC.

Antes de escribir se comprueban cantidad positiva, valores nulos, tipo de documento,
longitudes de nombre (1–200), teléfono y documento (1–32), sorteo activo, ventana
de ventas, tope por compra, cupo y rango de enteros. Los textos se recortan en los extremos; estas
validaciones **no acreditan identidad ni propiedad del teléfono/documento**.
El precio se lee del sorteo dentro del mismo `UPDATE` que reserva cupo; los gratis
se calculan como `cantidad / 4`. El cliente no puede elegir monto, gratis, código,
estado ni auditoría. `calcular_monto_total` es solo una previsualización: su precio
de entrada nunca determina el precio de una compra. Con cantidad cero y precio
válido devuelve `0/0/0/0` para el estado inicial del selector. Comprar cero tickets
sigue siendo inválido, al igual que cantidades negativas o nulas.

`sorteos.max_tickets_por_compra` es un entero positivo, obligatorio y con valor
predeterminado 50. El admin puede configurarlo por edición al crear o editar un
sorteo. Se compara con `p_cantidad` (tickets pagados); los gratis se suman solamente
al consumo de cupo. Por ejemplo, 50 comprados reservan 62 tickets con la promoción.
La comprobación forma parte del `UPDATE` que reserva: un cambio concurrente del
tope no puede eludir la condición. Si no se reserva, se consulta el límite vigente
del sorteo habilitado para distinguir el error:

| `error.code` de la RPC | Significado |
| --- | --- |
| `P1001` | La cantidad comprada supera `max_tickets_por_compra`; el mensaje incluye el máximo. |
| `P0001` | No hay cupo, la venta no está habilitada o el monto excede el rango admitido. |

El frontend puede discriminar por código sin interpretar el texto del mensaje.
Superar el tope no crea boletos ni modifica el contador.

La reserva usa un `UPDATE` condicionado por capacidad, incluidos los tickets gratis.
La creación del boleto pertenece a la misma transacción: si falla, la reserva se
revierte. Los productos y sumas intermedios usan `bigint` para detectar desbordamientos;
las columnas monetarias y los resultados continúan siendo `integer` en COP.
La RPC devuelve únicamente el boleto que acaba de crear con los datos recibidos,
sin consultar compras anteriores del documento. El código secuencial conserva
al menos cinco dígitos sin truncarse al superar `99999`; no es un secreto de acceso.

Esta protección de privilegios no sustituye controles contra abuso. Captcha,
idempotencia y límites acumulados de reservas siguen pendientes de decisión;
el tope por llamada no impide realizar varias compras. La caducidad de pendientes
(TTL) limita cuánto tiempo retienen cupo las reservas abandonadas, pero no impide
que alguien vuelva a reservar. Al permitir llamada directa con anon, un captcha
solamente en el formulario podría eludirse.

## Caducidad de pendientes

`sorteos.ttl_pendientes_horas` es un entero positivo, obligatorio y configurable
por edición, con **24 horas** como valor predeterminado. Un día deja margen para
pagar por Nequi, enviar el comprobante y revisar manualmente una compra hecha por
la noche, sin reservar cupo indefinidamente. Es una propuesta operativa: el admin
debe aumentarlo si su horario de revisión no permite atender dentro de ese plazo.
Los permisos de columna admiten INSERT/UPDATE del TTL solo bajo la política admin;
la auditoría de configuración existente registra quién lo cambia.

Se mide desde `boletos.created_at`, con tiempos `timestamptz`, y solo se caduca
cuando la antigüedad es **mayor** que el TTL. Cada ejecución usa el TTL del sorteo
visible en su consulta, también para reservas ya existentes: reducirlo puede
caducarlas en la siguiente ejecución; aumentarlo les da más tiempo, pero nunca
reactiva rechazados. No se guarda un vencimiento fijo por boleto ni se reinicia
el plazo al volver de `validado` a `pendiente`. Un cambio del TTL mientras corre
un lote se observa en la siguiente ejecución. También se procesan sorteos cerrados
o inactivos, pues sus reservas siguen reteniendo cupo.

El job `caducar-boletos-pendientes` ejecuta `caducar_boletos_pendientes()` con
`*/5 * * * *`. Cinco minutos son un intervalo pequeño frente a 24 horas y evitan
trabajo por segundo: 288 ejecuciones diarias. Cada llamada procesa hasta **1000
boletos**, prioriza los más antiguos y usa un índice parcial de pendientes para
no recorrer el historial de revisados. Sin acumulación, bloqueos o fallos, la
liberación sucede en la siguiente ejecución después de vencer; no se promete un
máximo estricto de cinco minutos. Un atraso mayor requiere varios lotes.

El job usa `lock_timeout = '5s'` y `statement_timeout = '30s'` para acotar esperas
y duración. Un fallo revierte el lote completo y el siguiente intervalo vuelve
a intentarlo. Si falla la comprobación del contador del trigger, la caducidad
tampoco queda confirmada: Andy debe revisar esa inconsistencia. No se ocultan errores.
`pg_cron` se habilita con `IF NOT EXISTS`; el nombre estable del job permite
reprogramarlo con `cron.schedule` sin duplicarlo para el mismo propietario.
La ejecución corre con el rol que aplica la migración, que debe ser el rol
administrativo de Supabase con acceso a las tablas y a `cron`. La función usa
`SECURITY INVOKER`, búsqueda vacía y referencias calificadas: no necesita elevar
privilegios. Se revoca EXECUTE a PUBLIC, anon, authenticated y service_role;
no se agrega una RPC pública ni se entrega el planificador al navegador.
Estas propiedades del planificador están documentadas en
[pg_cron](https://github.com/citusdata/pg_cron).

### Motivo y liberación de cupo

| `motivo_rechazo` | `validado_por` | Origen |
| --- | --- | --- |
| `manual` | `admin:<user_id>` | Decisión del admin |
| `caducidad` | `sistema:caducidad` | Vencimiento automático |
| `servicio` | Identificador del servicio | Otro proceso confiable, por ejemplo OCR |
| `null` | Según estado | Boleto pendiente o validado, sin rechazo |

`registrar_revision_boleto` calcula el motivo, autor y fecha de revisión en el
servidor; el navegador no tiene permiso de escribir `motivo_rechazo`. Intentar
enviar el identificador de caducidad como admin sigue registrando un rechazo
manual. Sin cambio de estado se preservan motivo y auditoría anteriores. Los
rechazados históricos se clasifican como manuales cuando su autor empieza por
`admin:`; los demás quedan como `servicio`, sin inventar caducidades anteriores.
Ese relleno no cambia estados, fechas, autores ni contadores.

La tarea solo cambia `pendiente` a `rechazado` y asigna su identificador de sistema.
**No modifica `tickets_vendidos`, no llama directamente al liberador ni desactiva
triggers.** El trigger existente `liberar_tickets_rechazados` sigue siendo la única
vía que resta `old.cantidad_total`, incluidos los gratis. Rechazo, motivo, auditoría
y liberación se confirman en la misma transacción. Repetir la tarea no selecciona
rechazados y repetir el rechazo tampoco libera de nuevo. El estado sigue terminal.

### Revisión simultánea del admin

Abrir un boleto en el panel no lo bloquea ni extiende el plazo. La tarea selecciona
filas con `FOR UPDATE OF boletos SKIP LOCKED`: salta las que otra transacción está
editando y las vuelve a considerar en ejecuciones posteriores. Esta es la semántica
de [bloqueos de filas de PostgreSQL](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE).

- Si el admin guarda la validación primero y confirma su transacción, el boleto
  ya no es pendiente y la tarea no lo caduca. Se permite validar después del umbral
  de horas mientras la caducidad todavía no se haya confirmado.
- Si el job bloquea y confirma el rechazo primero, una validación concurrente
  espera y luego falla con **`P1002`**: debe recargarse el boleto. El cupo ya fue
  liberado; ni la validación ni volver a pendiente pueden reactivarlo.
- Si la transacción que obtuvo el bloqueo revierte, no hay cambio confirmado;
  la otra operación o el siguiente ciclo puede proceder. Un rechazo manual que
  gana la carrera conserva motivo `manual`, nunca se reclasifica como caducidad.

El contrato recomendado para el panel es actualizar por `id` **y**
`estado = 'pendiente'`, pedir la fila modificada y tratar cero filas como un
conflicto que exige recarga. Con ese filtro, si ganó la caducidad se reciben cero
filas; si se intenta reactivar directamente sin el filtro, se recibe `P1002`.
Un segundo rechazo sin filtro es idempotente y conserva el motivo de caducidad.
La integración del panel y la regeneración de tipos quedan fuera de esta entrega.

### Comprobaciones de caducidad para Andy

No se aplicaron estas migraciones ni se ejecutó el job durante su preparación.
Después de aplicarlas en desarrollo con el rol administrativo:

- Probar dos sorteos con TTL distintos, pendientes por debajo/en el umbral/por
  encima de él, y boletos ya validados o rechazados; solo caducan los pendientes
  con antigüedad mayor. Verificar también sorteos inactivos y cambios del TTL.
- Confirmar motivo `caducidad`, autor `sistema:caducidad`, fecha de revisión y
  disminución exacta de comprados más gratis. Repetir la tarea y el rechazo; el
  contador y la auditoría deben permanecer iguales. Validar la clasificación de
  rechazos previos y el motivo `manual` de los nuevos rechazos administrativos.
- En dos sesiones, mantener abierta una transacción de revisión y ejecutar el
  job: debe saltar el boleto bloqueado. Repetir invirtiendo el orden y verificar
  `P1002` o cero filas según el filtro; probar también ROLLBACK de cada operación.
- Crear más de 1000 pendientes vencidos: comprobar lotes sucesivos y que cada
  boleto libera una vez. Simular un fallo del contador y verificar que revierte
  todo el lote, sin dejar rechazos confirmados ni cupos parcialmente liberados.
- Comprobar que anon, un usuario común, un admin por API y service_role no pueden
  ejecutar la función. Los admins pueden editar TTL y leer motivos mediante sus
  permisos existentes, pero no sobrescribir motivos ni reactivar rechazados.
- Revisar `cron.job` y `cron.job_run_details`: un único job con el nombre indicado,
  periodicidad y rol correctos, ejecuciones exitosas y fallos visibles. Si el
  proyecto está pausado o cron detenido, los pendientes conservan el cupo hasta
  que se reanuden las ejecuciones; el lote procesa los vencidos acumulados.

La instalación y monitorización se basan en la
[documentación de Supabase Cron](https://supabase.com/docs/guides/cron).

## Datos personales y administración

| Recurso | Público (`anon`) | Sesión sin admin | Admin de la whitelist |
| --- | --- | --- | --- |
| Sorteos | Lee activos | Lee activos | Lee todos y administra configuración |
| Premios | Lee los de sorteos activos | Lee los de sorteos activos | Lee todos, crea, edita y elimina |
| Ganadores | Lee | Lee | Lee, crea, edita y elimina |
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

La lectura pública de premios exige que su sorteo esté activo, para proteger los
borradores y sus valores referenciales. El admin conserva acceso a los premios de
sorteos inactivos. El historial de ganadores sigue siendo público.
`ganadores.boleto_id` no concede acceso al boleto
relacionado: las consultas anidadas siguen sujetas a los permisos y RLS de boletos.
Los buckets se crean con `on conflict (id) do nothing`: si ya existen se conserva
su configuración y la migración puede completar las políticas. Al crearlos,
`sorteos-banners` es público y `comprobantes-pago` es privado. Este último no recibe
políticas de navegador; su acceso futuro corresponde a una Edge Function con
credenciales de servicio. Andy debe verificar esos modos si los buckets ya existían.

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

- Comprobar `calcular_monto_total(0, 5000)` → `0/0/0/0` y 4 comprados → 1 gratis,
  total 5 y monto 20000 COP. Rechazar compras con cero, nulos, negativos, texto vacío,
  documento inválido y desbordamientos; el cálculo tampoco admite precio inválido.
- Con cupo suficiente y tope 50, comprar 50 debe reservar 62 y comprar 51 debe
  devolver `P1001` sin mutaciones. Ajustar el tope como admin y repetir; una compra
  dentro del tope pero sin cupo debe devolver `P0001`. Probar cambios concurrentes
  del tope y rechazar límites nulos/no positivos y números de edición duplicados.
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
- Confirmar que anon y usuarios sin admin no leen premios de sorteos inactivos,
  mientras que el admin sí. Aplicar la tercera migración con ninguno, uno o ambos
  buckets preexistentes y confirmar que se crean las políticas sin alterar esos buckets.
- Ejecutar el seed solo en desarrollo y comprobar el sorteo activo, sus cuatro
  premios y los valores 5000; repetirlo y comprobar que no duplica registros.

Referencias para las decisiones de permisos: [funciones de Supabase](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)
y [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
