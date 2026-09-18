// Tipografía compartida por los enlaces y los textos que todavía no lo son.
const ENLACE = 'text-[11px] leading-none font-medium tracking-[.16em] text-hueso/80 uppercase'

/** Franja final: marca calada, frase, enlaces legales y aviso de no afiliación. */
export default function Footer() {
  return (
    <footer
      data-cursor-color="var(--color-morado)"
      className="relative overflow-hidden bg-tinta px-lateral pt-[clamp(60px,9vh,110px)] pb-[90px] text-hueso"
    >
      {/* Marca decorativa, no un heading: la jerarquía de títulos ya la fija el
          contenido de arriba. El texto definitivo lo pone Andy. */}
      <p className="texto-outline m-0 font-display text-[clamp(58px,17vw,260px)] leading-[.84] tracking-[-.03em] uppercase">
        Sorteos
      </p>

      <p className="mt-[clamp(26px,4vh,50px)] mb-0 max-w-[420px] font-display text-[clamp(22px,3vw,40px)] leading-none uppercase">
        Tu próximo ticket puede cambiarlo todo.
      </p>

      <div className="mt-[clamp(34px,5vh,60px)] mb-[22px] flex flex-wrap gap-x-[30px] gap-y-[18px] border-t border-hueso/30 pt-[22px]">
        {/* TODO: términos, privacidad y contacto no tienen página todavía
            (pendiente #2 de docs/arquitectura.md). Hasta que existan van como
            texto: se ven igual que en el diseño, pero no fingen navegar. */}
        <span className={`${ENLACE} cursor-default`}>Términos y condiciones</span>
        {/* Ruta absoluta y <a> normal: en la landing baja al ancla sin recargar y
            desde /registro o /consulta —que montan el mismo footer— navega a ella. */}
        <a href="/#faq" className={`${ENLACE} hover:text-amarillo`}>
          Preguntas frecuentes
        </a>
        <span className={`${ENLACE} cursor-default`}>Política de privacidad</span>
        <span className={`${ENLACE} cursor-default`}>Contacto</span>
      </div>

      <p className="m-0 max-w-[640px] text-[11px] leading-[1.6] text-hueso/55">
        Plataforma de sorteos oficial. Sin afiliación, patrocinio ni relación con HYBE, BIGHIT MUSIC o BTS.
        Sorteos sujetos a términos y condiciones aplicables en Colombia.
      </p>
    </footer>
  )
}
