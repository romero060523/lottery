import { useGanadores } from '../../hooks/useGanadores'

/**
 * Hall of fame: ganadores históricos. No se renderiza mientras la tabla
 * `ganadores` esté vacía —la primera edición no tiene historia todavía— ni
 * mientras se carga o falla la consulta: una sección con el título y sin
 * ninguna ficha se lee como un sorteo que no entregó premios. Con la primera
 * fila registrada aparece sola, sin tocar el código.
 */
export default function GanadoresSection() {
  const { data: ganadores } = useGanadores()

  if (!ganadores || ganadores.length === 0) return null

  // TODO: implementar la lista con detalle al hacer hover (sección 7 de docs/arquitectura.md)
  return <section id="ganadores" className="px-4 py-16" />
}
