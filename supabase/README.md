# Esquema inicial de Supabase

Implementa las secciones 2 y 6 de `docs/arquitectura.md`. Andy aplica las
migraciones en el proyecto; la validación de esta entrega usa una instancia
local desechable, independiente de la base habitual y de la remota.
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
   inicio de pendiente, motivos corregibles, permisos e incidencias de caducidad.
5. `migrations/20260916000200_programar_caducidad_pendientes.sql`: validación de
   `pg_cron` ya habilitado y programación cada cinco minutos.

Al agregar o cambiar una migración, actualizar `docs/arquitectura.md` y correr
`node supabase/scripts/verificar-arquitectura.mjs` antes del PR: compara sentencia por
sentencia el SQL de la doc con el esquema efectivo de las migraciones (última versión de
cada función o trigger) y termina con código 1 si falta, sobra o se repite alguna.

`seeds/desarrollo.sql` está fuera de `migrations/`. `[db.seed]` lo carga al terminar
un `db reset` que haya aplicado correctamente todas las migraciones; `db push`
no lo incluye por defecto.
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

### Producción: habilitar Cron en Dashboard

Antes de aplicar cualquiera de las dos migraciones de caducidad, Andy debe abrir
**Dashboard > Integrations > Cron** en el proyecto y habilitar `pg_cron`. La
instalación de esa extensión no trusted requiere privilegios que el rol `postgres`
de Supabase no tiene: las migraciones no ejecutan `CREATE EXTENSION`.
La [guía oficial de instalación](https://supabase.com/docs/guides/cron/install)
describe el paso desde el Dashboard.

La primera migración comprueba la extensión y los permisos de uso/planificación
**antes de alterar tablas**; la segunda repite la comprobación antes de crear el
job. Si falta la extensión, fallan con SQLSTATE `55000` e instrucciones para
habilitarla; si faltan permisos, con `42501`. No se omite silenciosamente el job.
Una vez habilitada, Andy reintenta las migraciones pendientes, sin recrear la base.

### Desarrollo local: un comando de reset con Cron

`pnpm-lock.yaml` y el binario instalado fijan **2.117.0**. Esa versión no tiene
`db.extensions`, `db.enabled_extensions` ni una lista equivalente en `[db]`:
se comprobaron el [esquema de configuración](https://github.com/supabase/cli/blob/v2.117.0/packages/config/src/db.ts),
el [lector de configuración](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-config.toml-read.ts)
y el [bootstrap de la base](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/db-bootstrap/db-setup.ts).
No se añade una clave que el CLI no consume.

Instalar `pg_cron` y repetir `db reset` **no funciona**: el reset elimina esa
instalación antes de aplicar las migraciones. `roles.sql` se ejecuta antes de
migrar, pero con `postgres`; tampoco puede instalar esta extensión no trusted.
El rol local `postgres` no es superusuario ni miembro de `supabase_admin`.

Con Docker corriendo y las dependencias instaladas, ejecutar:

```bash
pnpm run db:reset:local
```

**Borra los datos de la base local** identificada por `project_id`. El script
`scripts/reset-local.mjs` funciona también sin contenedor previo y detiene la
secuencia ante cualquier error:

1. `supabase db start` inicia Postgres y los esquemas de Auth/Storage, omitiendo
   migraciones y seed solo en esa invocación mediante variables de entorno.
2. `supabase db reset --local --version 20260915000300 --no-seed` recrea la base
   y aplica las tres migraciones iniciales, independientes de Cron.
3. `docker exec ... psql -U supabase_admin` habilita `pg_cron` en la base ya
   recreada y concede al rol `postgres` uso del esquema y del planificador.
   No convierte a `postgres` en superusuario ni amplía privilegios de la API.
4. `supabase db push --local --include-seed` aplica las migraciones restantes
   y carga los archivos de `[db.seed].sql_paths`.

Se eligió este orden porque conserva intactas las comprobaciones de producción,
usa el historial del CLI para continuar y no duplica los SQL del seed. La frontera
`20260915000300` es la última migración histórica sin Cron; si se introduce una
dependencia anterior, hay que revisar esa frontera. No se requiere instalar Cron
a mano entre comandos ni cambiar temporalmente los archivos de migración.

El rodeo es **exclusivo de local**: todos los comandos que aplican migraciones
llevan `--local`, no se aceptan `--linked`, `--db-url` ni referencias remotas.
Para pruebas puede pasarse `--workdir <directorio-local>` con otro `project_id`
y puertos. El script inicia solo Postgres; `pnpm supabase start` levanta después
el resto de servicios si se necesitan para desarrollar la aplicación.
En producción se habilita Cron una sola vez desde el Dashboard antes del primer
`db push`; este script no se usa allí. Un `pnpm supabase db reset` directo sigue
sin cubrir el bootstrap de Cron en 2.117.0: usar el comando del proyecto.

### Plazo desde cada entrada a pendiente

`sorteos.ttl_pendientes_horas` es un entero entre **1 y 168 horas**, obligatorio y configurable
por edición, con **24 horas** como valor predeterminado. Un día deja margen para
pagar por Nequi, enviar el comprobante y revisar manualmente una compra hecha por
la noche, sin reservar cupo indefinidamente. Es una propuesta operativa: el admin
puede ampliarlo hasta una semana para cubrir su horario de revisión y fines de semana.
Los permisos de columna admiten INSERT/UPDATE del TTL solo bajo la política admin;
la auditoría de configuración existente registra quién lo cambia.

El plazo se mide desde **`boletos.pendiente_desde`**, que el trigger asigna al
insertar un pendiente o al volver de `validado` a `pendiente`. Esa vuelta concede
un TTL completo, incluso si la compra se creó hace meses. Guardar de nuevo un
pendiente sin cambiar su estado conserva el inicio. Al salir de pendiente se
limpia la fecha; `created_at` conserva la fecha original de compra. La API no
puede escribir `pendiente_desde`. Caducidad, entradas a pendiente, revisiones,
correcciones e incidencias usan **`statement_timestamp()`** y `timestamptz`.

Como los pendientes anteriores no registraban su última entrada a ese estado,
reciben un plazo completo desde la migración. No se infiere esa fecha de
`created_at`. La caducidad exige antigüedad estrictamente mayor que el TTL.
El job vuelve a comprobar el TTL después de bloquear el sorteo: reducirlo afecta
pendientes existentes; aumentarlo extiende su margen, sin reactivar rechazados.
También se procesan sorteos cerrados o inactivos.

El job `caducar-boletos-pendientes` ejecuta `caducar_boletos_pendientes()` con
`*/5 * * * *`. Cinco minutos son un intervalo pequeño frente a 24 horas y evitan
trabajo por segundo: 288 ejecuciones diarias. Cada llamada intenta hasta **1000
boletos**, agrupados por sorteo y ordenados por `pendiente_desde` dentro de cada
uno. Examina hasta 1000 candidatos por sorteo; los boletos bloqueados se saltan
sin consumir el presupuesto de intentos de los demás sorteos. Un índice parcial
cubre sorteo, inicio e ID de pendientes. Sin acumulación, bloqueos o fallos, la
liberación sucede en la siguiente ejecución después de vencer; no se promete un
máximo estricto de cinco minutos. Un atraso mayor requiere varios lotes.

Cada fila se procesa en un bloque PL/pgSQL con `EXCEPTION`: un error revierte
solo esa fila y sus triggers, según la [semántica de excepciones de PostgreSQL](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).
Se conserva el trabajo de las demás al confirmar
la llamada. La incidencia se guarda en `incidencias_caducidad` con IDs, SQLSTATE,
mensaje, fecha, intentos y próximo reintento. La fila fallida se aplaza **una hora**,
para que no monopolice los lotes. Un bloqueo advisory transaccional evita dos
ejecuciones simultáneas de la función, incluso si se invoca manualmente.

El job toma primero el boleto con `FOR UPDATE SKIP LOCKED` y luego el sorteo con
`FOR NO KEY UPDATE NOWAIT`. Ante contención (`55P03`, incluido `lock_timeout`),
abandona ese sorteo y continúa con el siguiente; aplaza el sorteo **diez minutos**.
No espera cinco segundos por cada boleto de la edición bloqueada. La tabla de
incidencias no tiene claves foráneas: registrar el fallo no debe esperar un lock
del mismo sorteo/boleto que lo causó. Sus escrituras quedan reservadas al rol
administrativo del job; los admins autenticados tienen lectura mediante RLS.

El comando mantiene `lock_timeout = '5s'` como límite de esperas no evitadas y
`statement_timeout = '2min'` como límite de emergencia. Una cancelación global,
desconexión o fallo del propio registro de incidencias todavía revierte la llamada;
los errores ordinarios de fila y la contención de sorteos se aíslan. Los errores
capturados se consultan en `incidencias_caducidad`; el job puede figurar como
exitoso en `cron.job_run_details` habiendo procesado otros boletos sanos.

### Consulta admin de cuarentenas y resolución de incidencias

`public.ediciones_en_cuarentena` entrega una fila por edición con incidencias
abiertas de contador (`P1003`) o contención (`55P03`). Expone `sorteo_id`,
`edicion_numero`, `nombre`, `cuarentena_desde`, `ultimo_fallo_en`,
`reintentar_desde` y `motivos` (JSON con boleto, código, mensaje, inicio e intentos).
`primera_incidencia_en` conserva el primer fallo de la misma causa en los
reintentos; `registrado_en` registra el último. Si cambia el código, comienza
un nuevo intervalo para esa causa. Una fecha de reintento vencida significa que
el job puede volver a intentarlo, no que la incidencia esté resuelta: sigue visible.

```sql
select * from public.ediciones_en_cuarentena order by cuarentena_desde;
```

La vista usa `security_invoker = true` y los permisos/RLS de sus tablas: un
admin autenticado ve también ediciones inactivas; una sesión sin admin obtiene
cero filas y `anon` carece de SELECT. No expone datos personales ni concede
escritura. La UI y sus alertas quedan para el panel; consultar solo el resultado
del cron o el número de caducados no basta para detectar una cuarentena.

Al guardar `validado` o `rechazado`, un trigger elimina la incidencia de ese
boleto dentro de la misma transacción, también en la revisión manual o del
servicio. Un error o ROLLBACK restaura tanto estado como incidencia. El admin
no recibe DELETE ni una RPC privilegiada para saltarse una cuarentena pendiente.
El job limpia incidencias de boletos ya revisados o inexistentes, saltando las
incidencias bloqueadas; además, tanto la selección de ediciones como la vista
ignoran registros cuyo boleto ya no esté pendiente. Esto cubre una incidencia
registrada después de una validación concurrente.

Resolver la incidencia de un boleto **no concilia el contador**: si la edición
sigue inconsistente, la siguiente reserva vencida vuelve a producir `P1003`, sin
esperar el aplazamiento del boleto validado. Las incidencias de otras reservas
pendientes permanecen. La tabla representa incidencias abiertas, no un historial
permanente de resoluciones; la auditoría de la revisión queda en `boletos`.

El nombre estable del job permite reprogramarlo con `cron.schedule` para el mismo
propietario: su [implementación](https://github.com/citusdata/pg_cron/blob/v1.6.5/src/job_metadata.c#L229-L237)
actualiza horario y comando ante conflicto de nombre/usuario.
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

`registrar_revision_boleto` calcula el motivo, autor y fecha del rechazo inicial.
Un admin autenticado puede **corregir `motivo_rechazo` sin cambiar el estado**;
el servidor registra `motivo_corregido_por` y `motivo_corregido_en` de la última
corrección. Se conservan `validado_por` y `validado_en` como autor y fecha del
rechazo original, y no se toca el contador. Valores inválidos fallan explícitamente.
Usuarios comunes y service_role no pueden corregir el motivo. Intentar
enviar el identificador de caducidad como admin sigue registrando un rechazo
manual. Repetir el mismo motivo no reescribe la auditoría de corrección. Los
rechazados históricos se clasifican como manuales cuando su autor empieza por
`admin:`; los demás quedan como `servicio`, sin inventar caducidades anteriores.
Ese relleno no cambia estados, fechas, autores ni contadores.

**Origen cerrado:** service_role pierde INSERT, DELETE, TRUNCATE y la escritura
general de boletos. Conserva SELECT y UPDATE de estado/autor/fecha de revisión,
método de pago y comprobante. Para crear una compra, también la futura Edge
Function debe llamar a `comprar_tickets`, cuyo SECURITY DEFINER reserva e inserta
atómicamente; la Edge Function de Nequi solo actualiza el pago/revisión de ese
boleto. Tampoco puede alterar cantidades, sorteo ni el inicio de pendiente.

Se elige revocar el INSERT directo porque `comprar_tickets` ya ofrece una única
vía de reserva atómica; no hace falta agregar una segunda forma de registrar
reservas. Para datos históricos posiblemente corruptos, el job bloquea el sorteo
y compara su contador con la suma de comprados más gratis de pendientes y
validados, antes de caducar la primera fila de esa edición. Un desajuste produce
**`P1003`**: registra una incidencia, aplaza el sorteo una hora y sigue con otros.
La fila anotada es la candidata que detectó el desajuste; no identifica por sí
sola al boleto sin reserva. Sin procedencia histórica no puede determinarse cuál
reserva es legítima: esa edición requiere conciliación manual. El job no resta
cupos de ella ni modifica automáticamente su contador. Esto protege también el
caso de un boleto sin reserva cuyo importe en tickets cabe en el contador ajeno.
El job hace una comprobación inicial por sorteo y la repite tras un fallo de fila.
Además, `liberar_tickets_rechazados` aplica la misma guarda **en cada rechazo**,
manual, de servicio o de caducidad, con el contador bloqueado. Un desajuste lanza
`P1003` y revierte estado, auditoría y liberación: que la cantidad quepa en el
contador no demuestra que ese boleto haya reservado cupo.

El liberador pasa a `BEFORE UPDATE OF estado`: la suma todavía incluye el boleto
actual, y las filas previas de un UPDATE múltiple ya reflejan su liberación. Un
trigger AFTER por fila vería todos los estados nuevos antes de haber restado todos
los cupos y daría falsos desajustes. Esta [visibilidad de triggers](https://www.postgresql.org/docs/17/trigger-datachanges.html)
permite rechazar varias reservas sanas en una sentencia y conservar la atomicidad.
La suma por rechazo agrega costo también al job; no se agrega ninguna suma a
`comprar_tickets` ni se modifica su camino de reserva.

Tras esa comprobación, la tarea cambia `pendiente` a `rechazado` y asigna su identificador de sistema.
**No modifica `tickets_vendidos`, no llama directamente al liberador ni desactiva
triggers.** El trigger existente `liberar_tickets_rechazados` sigue siendo la única
vía que resta `old.cantidad_total`, incluidos los gratis. Rechazo, motivo, auditoría
y liberación se confirman juntos para cada fila exitosa. Una excepción revierte
los cambios de esa fila, incluidos los del trigger, y permite continuar. Repetir la tarea no selecciona
rechazados y repetir el rechazo tampoco libera de nuevo. El estado sigue terminal.

### Revisión simultánea del admin

Abrir un boleto en el panel no lo bloquea ni extiende el plazo. La tarea bloquea
cada fila dentro de su bloque de errores con `FOR UPDATE SKIP LOCKED`: salta las
que otra transacción está editando y las considera después. Esta es la semántica
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

**M3 pendiente para quien construya el panel:** las operaciones multisentencia
deben respetar el orden **boletos → sorteos**, con un orden estable de IDs si
tocan varias filas. Evitar tomar primero el sorteo y luego un boleto: invierte
el orden del job y de la liberación. Este PR no incorpora el RPC de revisión
ni resuelve el protocolo de locks/reintentos del futuro panel; M3 sigue abierto.

**Ese orden ya no basta en los rechazos de varias filas.** Con el liberador en
`BEFORE UPDATE`, un `UPDATE` que rechaza varios boletos del mismo sorteo bloquea
el sorteo al procesar la primera fila y después espera la siguiente. Si otra
transacción ya bloqueó uno de esos boletos y luego lo rechaza, respetando el orden
boletos → sorteos, cada una espera a la otra y PostgreSQL aborta una con
**`40P01`** (deadlock). Con el trigger `AFTER` anterior, la misma intercalación
terminaba sin deadlock. No se corrompen datos: la transacción abortada revierte
estado, auditoría y liberación. El job no entra en ese ciclo porque salta boletos
bloqueados y pide el sorteo con `NOWAIT`. El panel debe:

- rechazar **un boleto por sentencia**, cada una en su propia transacción (una
  petición por boleto); dos rechazos seguidos dentro de la misma transacción
  conservan el lock del sorteo igual que un `UPDATE` múltiple; o bien bloquear
  primero todos los boletos afectados con `select ... for update order by id` y
  después ejecutar el `UPDATE` múltiple en esa misma transacción;
- reintentar la operación completa ante `40P01`, recargando los boletos.

**Límites transitorios sin cambios:** se conserva `statement_timeout = '2min'`
en el comando del cron. Una cancelación global revierte toda la corrida; no se
resuelve aquí el caso de livelock ni se garantiza progreso de ese lote. También
se conserva el presupuesto de **1000 intentos por corrida**, sin rediseñar el
reparto entre ediciones.

**M4 resuelto:** `docs/arquitectura.md` ya describe las cinco migraciones, incluida la
caducidad (columnas, constraints, permisos, incidencias, vista, job y liberador en
`BEFORE`), y recoge M3 en sus pendientes.

### Validación ejecutada y comprobaciones adicionales

Segunda revisión ejecutada en un contenedor desechable con otro `project_id` y
puertos, usando CLI **2.117.0** y la imagen Supabase Postgres **17.6.1.167**:

- Dos ejecuciones consecutivas de `pnpm run db:reset:local --workdir <pruebas>`
  terminaron sin errores; la primera inició sin contenedor previo y ambas
  recrearon la base desde cero. Tras cada una: cinco migraciones, un sorteo de
  seed con cuatro premios y un único job `caducar-boletos-pendientes`.
- **34 pruebas pgTAP: PASS.** Se ejecutaron con `pnpm supabase test db --workdir
  <pruebas>` sobre la segunda base reconstruida.
- Ambas guardas se ejecutaron sin `pg_cron` dentro de transacciones descartables:
  devolvieron `55000` con mensaje e instrucciones antes de cualquier DDL/job.
- `node --check`, oxlint del script y `git diff --check` pasaron.

La base local habitual y el proyecto remoto no recibieron migraciones ni cambios.

`tests/caducidad_regresion.sql` y `tests/caducidad_contrato.sql` preparan fixtures
dentro de una transacción y terminan con ROLLBACK; `pnpm supabase test db` ejecuta
ambos. Cada archivo toma primero el lock advisory del job y reinicia, dentro de su
transacción, el plazo de los pendientes que ya existían: una compra abandonada en la
base de desarrollo o una corrida simultánea de cron no alteran los resultados.

`caducidad_regresion.sql` cubre el huérfano de 10 tickets en rechazo manual, rechazo
desde validado, UPDATE múltiple sano, idempotencia, cron con edición
sana/inconsistente, RLS de la vista, antigüedad del fallo, validación con rollback,
incidencias tardías y rechazo tras conciliación. `caducidad_contrato.sql` fija TTL
1–168, plazo desde cada entrada a pendiente y umbral estricto, autor y motivo de la
caducidad, `P1002`, corrección auditada del motivo, origen cerrado de service_role,
aislamiento de un error ordinario de fila, y función y job no expuestos.
La incidencia tardía se prueba mediante una intercalación simulada; ni ella ni la
contención `55P03` sustituyen las comprobaciones con dos sesiones que siguen a
continuación. Para ampliar la revisión operativa después de aplicar en desarrollo:

- Probar pg_cron ausente: error `55000` antes del primer ALTER de caducidad y antes
  de programar; con pg_cron habilitado y permisos, no debe intentarse instalarlo.
  Probar TTL 0, 1, 168 y 169; solo 1–168 es válido.
- Probar dos sorteos con TTL distintos, pendientes por debajo/en el umbral/por
  encima de él, y boletos ya validados o rechazados; solo caducan los pendientes
  con antigüedad mayor desde `pendiente_desde`. Verificar también sorteos inactivos
  y cambios del TTL. Volver a pendiente una compra validada de hace varios días:
  debe recibir un plazo completo; guardar nuevamente pendiente no debe reiniciarlo.
- Confirmar motivo `caducidad`, autor `sistema:caducidad`, fecha de revisión y
  disminución exacta de comprados más gratis. Repetir la tarea y el rechazo; el
  contador y la auditoría deben permanecer iguales. Validar la clasificación de
  rechazos previos y el motivo `manual` de los nuevos rechazos administrativos.
- En dos sesiones, mantener abierta una transacción de revisión y ejecutar el
  job: debe saltar el boleto bloqueado. Repetir invirtiendo el orden y verificar
  `P1002` o cero filas según el filtro; probar también ROLLBACK de cada operación.
- Como service_role, INSERT directo debe fallar con permisos insuficientes;
  comprar por RPC y actualizar pago/estado deben funcionar. DELETE, TRUNCATE y
  cambios de cantidad, sorteo o inicio deben fallar.
- Preparar una fila problemática por una vía privilegiada en desarrollo y un
  sorteo sano. Repetir el job tres veces: el sano libera y el problemático registra
  su incidencia/reintento. Con un boleto sin reserva de 10 y un contador de 10
  perteneciente a otros boletos, debe aparecer `P1003` sin descontar esos 10.
- Forzar un error de trigger en una sola fila con contador consistente: otras
  filas del mismo sorteo deben continuar y el fallo quedar aplazado. Crear más de
  1000 vencidos y verificar lotes sucesivos sin doble liberación.
- En otra sesión mantener bloqueado un sorteo; el job debe registrar `55P03`,
  saltar esa edición y liberar la sana en la misma ejecución. Verificar que el
  registro de la incidencia no espera por una FK al sorteo bloqueado.
  Repetir bloqueando 1000 boletos de una edición: las filas omitidas no deben
  consumir el presupuesto e impedir la caducidad de otra edición sana.
- Como admin, corregir motivo de un rechazado: debe persistir el motivo, conservar
  autor/fecha originales, registrar corrector/fecha y no variar el cupo. Repetirlo,
  intentar valor inválido y corregir como usuario común/service_role.
- Comprobar que anon, un usuario común, un admin por API y service_role no pueden
  ejecutar la función. Los admins pueden editar TTL y leer motivos mediante sus
  permisos existentes y corregir motivos con auditoría; no pueden reactivar rechazados.
- Revisar `cron.job` y `cron.job_run_details`: un único job con el nombre indicado,
  periodicidad y rol correctos, ejecuciones exitosas y fallos visibles. Si el
  proyecto está pausado o cron detenido, los pendientes conservan el cupo hasta
  que se reanuden las ejecuciones. Consultar también `incidencias_caducidad`:
  reparar la causa por una vía administrativa y esperar el reintento o eliminar
  la incidencia mediante SQL administrativo para adelantarlo. Los contadores
  inconsistentes requieren conciliación de reservas antes de reintentar.

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
admiten `estado`, `validado_por`, `validado_en` y corrección auditada de `motivo_rechazo`. No hay INSERT ni DELETE
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
