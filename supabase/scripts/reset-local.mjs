import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// La última migración independiente de pg_cron es estable en el historial.
const versionAntesDeCron = '20260915000300'
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('supabase/package.json')), 'dist/supabase.js')
const argumentos = process.argv.slice(2)
if (argumentos.length !== 0 && (argumentos.length !== 2 || argumentos[0] !== '--workdir')) {
  console.error('Uso: pnpm run db:reset:local [--workdir <directorio-local>]')
  process.exit(1)
}
const workdir = argumentos.length
  ? resolve(argumentos[1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function ejecutar(comando, args, env = {}) {
  const resultado = spawnSync(comando, args, {
    cwd: workdir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (resultado.error) throw resultado.error
  if (resultado.status !== 0) {
    throw new Error(`${comando} terminó con ${resultado.signal ?? resultado.status}; se detiene el reset.`)
  }
}

function supabase(args, env) {
  ejecutar(process.execPath, [cli, ...args, '--workdir', workdir, '--yes'], env)
}

try {
  // Solo se admite el project_id literal de este proyecto, nunca una URL o ref
  // remota. La restricción permite construir el nombre Docker sin ejecutar shell.
  const config = readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')
  const cabecera = config.split(/^\s*\[/m)[0]
  const projectId = cabecera.match(/^\s*project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*(?:#.*)?$/m)?.[1]
  if (!projectId) throw new Error('Se requiere project_id literal entre comillas dobles en config.toml.')
  const contenedor = `supabase_db_${projectId}`
  console.log(`Reset exclusivo de la base local ${contenedor}; se borrarán sus datos de desarrollo.`)

  // También funciona sin contenedor previo. Solo esta llamada omite migraciones
  // y seed; se crean los esquemas de Auth/Storage que necesita el esquema inicial.
  supabase(['db', 'start'], {
    SUPABASE_DB_MIGRATIONS_ENABLED: 'false',
    SUPABASE_DB_SEED_ENABLED: 'false',
  })
  supabase(['db', 'reset', '--local', '--version', versionAntesDeCron, '--no-seed'])

  // La extensión no trusted necesita al superusuario REAL del contenedor local.
  // No se elevan permisos de postgres ni de ningún rol de la API.
  ejecutar('docker', [
    'exec', contenedor, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'supabase_admin', '-d', 'postgres', '-c',
    'create extension if not exists pg_cron; grant usage on schema cron to postgres; grant execute on function cron.schedule(text,text,text) to postgres;',
  ])

  // El CLI aplica el resto y usa [db.seed].sql_paths, sin duplicar la lista del
  // seed en este script. --local es obligatorio, incluso si el repo está enlazado.
  supabase(['db', 'push', '--local', '--include-seed'])
  console.log('Reset local completo: migraciones, pg_cron y seed aplicados.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
