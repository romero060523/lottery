## Contexto del proyecto

La arquitectura completa (esquema de BD, stack, flujo de pagos, decisiones
de escalabilidad) está en `docs/arquitectura.md`. Léela antes de escribir
código o migraciones. Si algo de lo que vas a implementar la contradice,
pregunta en vez de asumir.

## Flujo de trabajo con git

- NUNCA commitear directo a `main`. Todo cambio va en una rama.
- Una rama por unidad de trabajo, creada desde `main` actualizado.
- Nomenclatura: `feat/`, `fix/`, `chore/`, `docs/` + descripción corta en kebab-case.
  Ejemplos: `feat/esquema-inicial`, `feat/landing-hero`, `fix/countdown-timezone`
- Commits en español, imperativo, sin atribución de IA.
- Al terminar: push de la rama y abrir PR. NO mergear tú — Andy revisa y mergea.
- Antes de empezar una rama nueva: `git checkout main && git pull`