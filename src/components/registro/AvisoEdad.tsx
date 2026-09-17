/** Requisito de edad, arriba del formulario. */
export default function AvisoEdad() {
  return (
    <div className="flex items-start gap-4 border border-tinta bg-amarillo/25 p-[18px]">
      <span
        aria-hidden="true"
        className="flex size-12 flex-none items-center justify-center rounded-full bg-tinta font-display text-[20px] leading-none text-amarillo"
      >
        18+
      </span>
      <div>
        <p className="m-0 mb-1.5 text-[13px] leading-none font-semibold tracking-[.12em] text-tinta uppercase">
          Solo participan mayores de edad
        </p>
        <p className="m-0 text-[13px] leading-[1.55] text-parrafo">Debes tener 18 años o más para participar.</p>
      </div>
    </div>
  )
}
