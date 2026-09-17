/**
 * Datos del pago manual. Viven aquí y no en la base: el flujo de pago todavía
 * no está definido (sección 3 de docs/arquitectura.md) y la landing solo los
 * muestra. `null` = aún sin definir; la UI avisa que están por confirmar.
 */
export const DATOS_PAGO: { medio: string; destinatario: string; numero: string } | null = null

/** Lo que el comprador escribe en el comentario del pago, en orden. */
export const DATOS_COMENTARIO = [
  { titulo: 'Nombre completo', ayuda: 'Tus nombres y apellidos como aparecen en tu documento.' },
  { titulo: 'Documento', ayuda: 'Tu número de documento de identidad.' },
  { titulo: 'Teléfono', ayuda: 'Un número donde podamos contactarte.' },
] as const
