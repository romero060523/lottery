import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compara los bloques ```sql de docs/arquitectura.md con el esquema EFECTIVO de
// supabase/migrations: una función redefinida reemplaza a la anterior y un
// drop trigger retira su create previo. La comparación es por sentencia, sin
// comentarios ni diferencias de espacios, así que detecta también cambios de un
// solo token dentro de los cuerpos de las funciones. Sale con 1 ante cualquier
// diferencia. No reconoce E'...' ni identificadores entre comillas dobles con ";".
const argumentos = process.argv.slice(2)
if (argumentos.length > 1) {
  console.error('Uso: node supabase/scripts/verificar-arquitectura.mjs [directorio-del-repo]')
  process.exit(1)
}
const repo = argumentos.length
  ? resolve(argumentos[0])
  : resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const TAG_DOLAR = /\$[A-Za-z_]*\$/y

// Parte el SQL en sentencias respetando strings y dollar-quotes, sin comentarios.
function sentencias(sql) {
  const salida = []
  let actual = ''
  let enString = false
  let tagDolar = null

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]

    if (enString) {
      actual += c
      if (c === "'" && sql[i + 1] === "'") {
        actual += sql[++i] // comilla escapada dentro del string
      } else if (c === "'") {
        enString = false
      }
      continue
    }

    if (c === "'") {
      enString = true
      actual += c
      continue
    }

    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      actual += '\n'
      continue
    }

    TAG_DOLAR.lastIndex = i
    const tag = TAG_DOLAR.exec(sql)?.[0]
    if (tag) {
      if (tagDolar === null) tagDolar = tag
      else if (tagDolar === tag) tagDolar = null
      actual += tag
      i += tag.length - 1
      continue
    }

    if (c === ';' && tagDolar === null) {
      salida.push(actual)
      actual = ''
      continue
    }

    actual += c
  }

  if (actual.trim()) salida.push(actual)
  return salida.map(normalizar).filter((s) => s && s !== 'begin' && s !== 'commit')
}

function normalizar(sentencia) {
  return sentencia
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;=])\s*/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/^create or replace function/, 'create function')
    .replace(/^create or replace view/, 'create view')
}

const nombreFuncion = (s) => /^create function ([\w.]+)\(/.exec(s)?.[1]
const nombreVista = (s) => /^create view ([\w.]+)/.exec(s)?.[1]
const nombreTrigger = (s) => /^create trigger (\w+)/.exec(s)?.[1]
const triggerEliminado = (s) => /^drop trigger (\w+)/.exec(s)?.[1]

const carpetaMigraciones = join(repo, 'supabase/migrations')
const migraciones = readdirSync(carpetaMigraciones).filter((f) => f.endsWith('.sql')).sort()
let efectivo = []
for (const archivo of migraciones) {
  for (const s of sentencias(readFileSync(join(carpetaMigraciones, archivo), 'utf8'))) {
    const funcion = nombreFuncion(s)
    if (funcion) efectivo = efectivo.filter((e) => nombreFuncion(e.s) !== funcion)

    const vista = nombreVista(s)
    if (vista) efectivo = efectivo.filter((e) => nombreVista(e.s) !== vista)

    const eliminado = triggerEliminado(s)
    if (eliminado) {
      efectivo = efectivo.filter((e) => nombreTrigger(e.s) !== eliminado)
      continue
    }

    efectivo.push({ s, archivo })
  }
}

const doc = readFileSync(join(repo, 'docs/arquitectura.md'), 'utf8')
const bloques = [...doc.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1])
const enDoc = bloques.flatMap(sentencias)

const setDoc = new Set(enDoc)
const setMigraciones = new Set(efectivo.map((e) => e.s))
const faltan = efectivo.filter((e) => !setDoc.has(e.s))
const sobran = enDoc.filter((s) => !setMigraciones.has(s))
const repetidas = enDoc.filter((s, i) => enDoc.indexOf(s) !== i)
const resumen = (s) => (s.length > 110 ? `${s.slice(0, 110)}…` : s)

console.log(
  `${migraciones.length} migraciones, ${efectivo.length} sentencias efectivas; ` +
    `${enDoc.length} sentencias en ${bloques.length} bloques sql de la doc.`,
)
console.log(`\nEn las migraciones y faltan en la doc: ${faltan.length}`)
for (const { s, archivo } of faltan) console.log(`  [${archivo}] ${resumen(s)}`)
console.log(`\nEn la doc sin equivalente efectivo (obsoletas o inexistentes): ${sobran.length}`)
for (const s of sobran) console.log(`  ${resumen(s)}`)
console.log(`\nRepetidas en la doc: ${repetidas.length}`)
for (const s of repetidas) console.log(`  ${resumen(s)}`)

if (faltan.length || sobran.length || repetidas.length) {
  console.error('\ndocs/arquitectura.md no coincide con las migraciones.')
  process.exitCode = 1
} else {
  console.log('\ndocs/arquitectura.md coincide con el esquema efectivo de las migraciones.')
}
