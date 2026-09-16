# Sistema de diseño — Purple Draw

Valores extraídos del prototipo de Claude Design. Esta es la fuente de verdad visual: cuando implementes un componente, usa estos valores, no aproximaciones.

El prototipo original está en `docs/design/purple-draw-landing.html` como referencia de layout y comportamiento. **No es código reutilizable** — usa el formato interno de Claude Design (bindings `{{ }}`, directivas `sc-if`/`sc-for`, clase `DCLogic`). Léelo para entender estructura y animaciones, tradúcelo a React.

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `tinta` | `#2A2A2A` | Texto principal, bordes, fondo de secciones oscuras |
| `hueso` | `#E9E8E6` | Fondo claro, texto sobre oscuro |
| `morado` | `#7B4AE2` | Color de marca. CTAs, acentos, premio mayor |
| `coral` | `#E8604C` | Acento secundario. Sección Ganadores, badges |
| `amarillo` | `#F2C230` | Acento terciario. Badge "Sorteo activo", totales |
| `azul` | `#3B82F6` | Acento cuaternario. Badges de precio, bonus |
| `gris-texto` | `#4a4845` | Párrafos, texto secundario |
| `gris-suave` | `#6b6862` | Labels dentro de placeholders de imagen |
| `placeholder-a` | `#d9d7d3` | Fondo de placeholder de foto (variante A) |
| `placeholder-b` | `#cfcdc9` | Fondo de placeholder de foto (variante B) |

Opacidades recurrentes sobre hueso: `.85`, `.8`, `.7`, `.65`, `.55`, `.45`.
Sobre tinta: `.45`, `.35`, `.3`, `.14`, `.12`.

## Tipografía

Dos familias, desde Google Fonts:

- **Anton** (400) — títulos, números grandes, todo lo que va en `text-transform: uppercase`
- **Inter** (400/500/600) — cuerpo, labels, botones

### Escala de títulos (Anton)

Todos con `line-height` entre `.84` y `.92`, `letter-spacing` entre `-.03em` y `-.015em`, `text-transform: uppercase`.

| Rol | Valor |
|---|---|
| H1 hero | `clamp(66px, 17.5vw, 268px)` |
| Footer "Borahae" | `clamp(58px, 17vw, 260px)` |
| H2 Tickets | `clamp(52px, 14vw, 210px)` |
| H2 sección | `clamp(44px, 11vw, 166px)` |
| H2 Ganadores | `clamp(40px, 9.5vw, 142px)` |
| Nav fullscreen | `clamp(44px, 11vw, 132px)` |
| Contador tickets | `clamp(64px, 11vw, 124px)` |
| Total a pagar | `clamp(52px, 9vw, 110px)` |
| Stats | `clamp(46px, 7vw, 92px)` |
| H2 FAQ | `clamp(34px, 6vw, 84px)` |
| H3 premio mayor | `clamp(34px, 6vw, 76px)` |
| Nombre ganador | `clamp(26px, 3.4vw, 44px)` |
| Countdown | `clamp(26px, 4vw, 44px)` |
| H4 premio secundario | `clamp(26px, 3.6vw, 42px)` |
| Pregunta FAQ | `clamp(20px, 3vw, 34px)` |

### Inter

- Párrafos: `400 15px/1.55`, color `gris-texto`, `max-width` ~420px
- Labels/eyebrow: `600 10px` o `600 11px`, `letter-spacing: .16em–.22em`, uppercase
- Botones: `600 13px/1`, `letter-spacing: .14em`, uppercase
- Legales: `400 11px/1.6` o `400 12px/1.5`

## Layout

Padding estándar de sección:

```css
padding: clamp(70px, 11vh, 140px) clamp(16px, 4vw, 48px);
```

Variantes: hero `clamp(96px,14vh,160px)` arriba; sección de transparencia `clamp(90px,14vh,170px)` abajo; footer `clamp(60px,9vh,110px)` arriba.

Separador entre secciones: `border-top: 1px solid rgba(42,42,42,.35)`.

Cada sección abre con un numerador (`01`, `02`, …) en `600 11px Inter`, `letter-spacing: .2em`, en el color de acento de esa sección, seguido de una línea `height: 1px`.

Breakpoint móvil: `window.innerWidth < 760`.

## Movimiento

**Una sola curva en todo el sitio:** `cubic-bezier(.2, .8, .2, 1)`. No introduzcas otras.

- **Scroll reveal de texto**: `opacity 0→1` + `translateY(24px→0)` (párrafos) o `translateY(50px→0)` (títulos), duración `.7s`–`1s`, escalonado con delays de `.06s`/`.1s`/`.12s`.
- **Scroll reveal de fotos**: `opacity 0→1` + `scale(.2)→scale(1)` con `rotate(35deg)` → su rotación de reposo (`data-rot`, entre `-8deg` y `8deg`). Duración `1s`–`1.2s`.
- **IntersectionObserver**: `threshold: 0.12`, `rootMargin: "0px 0px -8% 0px"`.
- **Failsafe**: si `prefers-reduced-motion` o la pestaña no está visible, revelar todo de inmediato. También un timeout de 1400ms por si el observer nunca dispara. Respetar `prefers-reduced-motion` no es opcional.
- **Parallax**: `data-par` entre `-0.1` y `-0.3`, aplicado con `translate3d` dentro de `requestAnimationFrame`.
- **Hover en cards de premio**: `scale(1.04)` y rotación al 30% de la de reposo.
- **Hover en flechas**: `translateX(10px)`, `.3s`.
- **Badge "Sorteo activo"**: punto con `@keyframes pdPulse`, `1.6s infinite`.

## Detalles con carácter

Son los que le dan personalidad al diseño; no los omitas por simplificar.

- **Sombras duras, sin blur**: `box-shadow: 16px 20px 0 rgba(42,42,42,.14)`. Nunca sombras difuminadas.
- **Bordes de 1px en tinta** sobre casi todo: fotos, badges, botones, la barra de progreso.
- **Rotaciones sutiles**: las fotos y los quick-picks van rotados entre `-8deg` y `8deg`. Es intencional.
- **Títulos en outline**: "Elige tu suerte" y "Borahae" usan `color: transparent` + `-webkit-text-stroke: 1.5px`.
- **Cursor personalizado**: punto de 10px que sigue el mouse y cambia de color según la sección (`data-cursor-color`). Solo en dispositivos con `hover: hover`.
- **Tinta del header adaptativa**: el logo cambia a hueso sobre secciones oscuras (Tickets, Ganadores, footer) y sobre el círculo morado que crece.
- **Círculo que crece**: en la sección de transparencia, un círculo morado escala de `.18` a `~3.3` con el scroll, e invierte el color del texto cuando lo cubre.
- **Radios**: `999px` en pills y botones; `6px` en quick-picks; `0` en fotos y placeholders.

## Reglas de implementación

1. Tailwind v4 con los colores de arriba como tokens en `@theme`, no valores sueltos repetidos por el código.
2. La lógica de scroll (reveal, parallax, círculo, tinta del header) va en hooks reutilizables — ya existen `useScrollReveal` y `useCountdown` como placeholders.
3. Cero `localStorage` / `sessionStorage`.
4. Las fotos son placeholders en el prototipo. Los componentes deben aceptar `imagen_url` de la BD y caer al placeholder cuando venga `null`.
5. Todos los montos por `utils/currency.ts`, nunca `"$" + n` a mano.
6. Mobile: el CTA fijo inferior aparece bajo 760px; las fotos del hero se reposicionan (ver `onResize` del prototipo).