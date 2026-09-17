// Trama decorativa del prototipo: 13 × 13 celdas con tres esquinas tipo QR. No
// codifica nada y no existe validación por escaneo (sección 7 de
// docs/arquitectura.md). Se conserva su aritmética en coma flotante para
// dibujar lo mismo que el diseño.
const CELDAS = (() => {
  const celdas: boolean[] = []
  let s = 7
  for (let i = 0; i < 169; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const fila = Math.floor(i / 13)
    const columna = i % 13
    const esquina = (fila < 3 && columna < 3) || (fila < 3 && columna > 9) || (fila > 9 && columna < 3)
    celdas.push(
      esquina
        ? !((fila === 1 && columna !== 1 && columna !== 11) || (columna === 1 && fila !== 1 && fila !== 11))
        : s % 100 > 52,
    )
  }
  return celdas
})()

/** Adorno del pase digital, igual en el ejemplo de la landing y en el pase emitido. */
export default function TramaQr() {
  return (
    <div
      aria-hidden="true"
      className="grid size-[104px] flex-none grid-cols-[repeat(13,1fr)] grid-rows-[repeat(13,1fr)] gap-px border border-tinta bg-hueso p-1.5"
    >
      {CELDAS.map((encendida, i) => (
        <span key={i} className={encendida ? 'bg-tinta' : undefined} />
      ))}
    </div>
  )
}
