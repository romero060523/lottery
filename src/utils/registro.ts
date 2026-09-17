import { z } from 'zod'

/** Los dos valores del CHECK `boletos_tipo_documento` y de `comprar_tickets`. */
export const TIPOS_DOCUMENTO = [
  { valor: 'cedula', etiqueta: 'Cédula' },
  { valor: 'pasaporte', etiqueta: 'Pasaporte' },
] as const

// `char_length` de Postgres cuenta caracteres; `String.length` cuenta unidades
// UTF-16. Con [...texto] ambos coinciden, así que un nombre con emoji se mide
// igual aquí que en el CHECK.
const caracteres = (texto: string) => [...texto].length

/**
 * Texto obligatorio medido después de recortar los extremos, igual que
 * `char_length(btrim(...)) between 1 and maximo`. El valor validado ya viene
 * recortado, como el que guarda `comprar_tickets` con su `btrim`.
 */
function textoRecortado(maximo: number, vacio: string, largo: string) {
  return z
    .string({ error: vacio })
    .trim()
    .refine((valor) => valor.length > 0, vacio)
    .refine((valor) => caracteres(valor) <= maximo, largo)
}

/**
 * Espeja las constraints reales del esquema: los CHECK de `public.boletos`
 * (migración 20260915000100) y las comprobaciones de `comprar_tickets`
 * (migración 20260916000300). `maximo` es la mayor `p_cantidad` que la RPC
 * aceptaría ahora mismo —tope por compra, cupo restante contando los gratis y
 * rango de `integer` del monto, todo en `maximoComprable`—, no una constante:
 * se rehace con cada refetch del sorteo.
 */
export function esquemaRegistro(maximo: number) {
  return z.object({
    nombre_comprador: textoRecortado(
      200,
      'Escribe el nombre de quien participa.',
      'El nombre no puede pasar de 200 caracteres.',
    ),
    telefono: textoRecortado(
      32,
      'Escribe un teléfono de contacto.',
      'El teléfono no puede pasar de 32 caracteres.',
    ),
    tipo_documento: z.enum(['cedula', 'pasaporte'], { error: 'Elige cédula o pasaporte.' }),
    numero_documento: textoRecortado(
      32,
      'Escribe el número de documento.',
      'El número de documento no puede pasar de 32 caracteres.',
    ),
    cantidad: z
      .number({ error: 'Escribe cuántos tickets quieres comprar.' })
      .int('La cantidad tiene que ser un número entero.')
      .min(1, 'Compra al menos 1 ticket.')
      .max(maximo, `Ahora mismo puedes comprar hasta ${maximo} ${maximo === 1 ? 'ticket' : 'tickets'}.`),
  })
}

export type DatosRegistro = z.infer<ReturnType<typeof esquemaRegistro>>
