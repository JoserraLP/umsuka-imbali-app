# Fix: páginas a ancho completo en ordenador (móvil intacto)

**Status:** Accepted (Implementado) · **Date:** 2026-08-20 · **Tipo:** Fix de UI
(CSS/Tailwind) · **Branch:** `fix/desktop-full-width-pages`

---

## Contexto

Desde el Sprint 1 (ADR-001), todas las páginas autenticadas se renderizan dentro
de `src/components/layout/app-shell.tsx`, cuyo `<main>` lleva `md:pl-sidebar`
(espacio reservado para el sidebar de escritorio) y envuelve el contenido con la
clase global `.feed-container`:

```tsx
<main className="md:pl-sidebar pb-16 md:pb-0">
  <div className="feed-container px-4 py-4 sm:px-6 sm:py-6">
    {children}
  </div>
</main>
```

`.feed-container` se define en `src/app/globals.css` (capa `@layer components`)
con el ancho de feed tipo X/Twitter introducido en el ADR-001 (línea 71:
*"centered wrapper with max-w-[600px] (X/Twitter feed width)"*; línea 136:
*"uses feed-container width"*):

```css
.feed-container {
  @apply mx-auto w-full max-w-[600px];
}
```

Consecuencia: en ordenador (≥768px, con sidebar visible vía `md:pl-sidebar`)
todas las páginas quedan en una **columna de 600px centrada** dentro del área
principal, dejando el resto de la pantalla vacía a la derecha e izquierda del
contenido. En móvil (<768px, con bottom nav) el ancho de feed de 600px es el
comportamiento deseado por diseño.

Requisito del usuario: **en ordenador las páginas deben ocupar todo el ancho
disponible; en móvil el layout actual debe mantenerse exactamente igual.**

Criterios de aceptación del task (`tasks/fix-desktop-full-width.json`): en
pantallas ≥768px las páginas autenticadas ocupan el 100% del ancho del área
principal (a la derecha del sidebar), sin columna centrada de 600px; en
pantallas <768px el layout se mantiene idéntico al actual (feed centrado de
600px con bottom nav).

---

## Decisión

### D1 — `.feed-container` responsive: `md:max-w-none`

Se modifica **un único archivo** (`src/app/globals.css`) añadiendo el prefijo
responsive `md:` a la clase:

```css
.feed-container {
  @apply mx-auto w-full max-w-[600px] md:max-w-none;
}
```

Mecánica del cambio:

- **<md (móvil, <768px)**: se conserva `max-w-[600px]` + `mx-auto` — el feed
  centrado de 600px actual, junto con el bottom nav, queda intacto.
- **≥md (desktop, ≥768px)**: `max-w-[600px]` queda anulado por `md:max-w-none`,
  de modo que el wrapper ocupa el **100% del ancho del `<main>`**, que ya
  compensa el sidebar con `md:pl-sidebar`.

Amplitud verificada del cambio:

- `.feed-container` solo se usa en `src/components/layout/app-shell.tsx`
  (verificado por grep: únicas apariciones la definición en `globals.css` y el
  uso en `app-shell.tsx`), por lo que el cambio es **global a todas las páginas
  autenticadas** y no afecta a ninguna otra vista (login, auth, error pages,
  etc. no usan AppShell).
- La página `/notifications` conserva su propio `max-w-3xl` anidado
  (`src/app/notifications/page.tsx`: `mx-auto flex max-w-3xl flex-col gap-6`):
  queda **fuera del alcance del fix, a propósito** — es un límite propio de esa
  página, no el wrapper global, y en desktop es un ancho de lectura razonable.
- Cambio puramente CSS en una capa Tailwind: cero cambios de lógica, cero
  cambios de componentes, cero cambios de tests de comportamiento.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) `max-w-none` con media query en CSS plano (`.feed-container { ... } @media (min-width: 768px) { .feed-container { max-width: none } }`) | Funcionalmente equivalente, pero menos idiomático Tailwind: la variante `md:` expresa el breakpoint de forma declarativa y consistente con el resto del codebase (el propio AppShell usa `md:pl-sidebar`). |
| (b) Quitar `.feed-container` del AppShell y añadir `max-w`/ancho completo página a página | Más invasivo: tocaría 20+ páginas autenticadas con riesgo de olvidos e inconsistencias (algunas páginas además tienen sus propios `max-w` internos como `/notifications`). La clase global es el punto único de control del wrapper. |
| (c) Ampliar el ancho a un valor fijo mayor (p. ej. `max-w-4xl`) en todas las pantallas | No cumple el requisito "ocupar toda la página": en monitores anchos seguiría habiendo espacio vacío a los lados; además cambiaría el ancho en móvil, que debe permanecer intacto. |

Se eligió la opción responsive sobre la clase existente (D1) por **mínima
superficie de cambio**: un solo archivo, una sola clase, móvil intacto por
construcción (el default de `max-w-[600px]` se mantiene).

---

## Consecuencias

### Positivas

- **Desktop aprovecha toda la pantalla**: las páginas autenticadas se expanden
  al 100% del área principal a la derecha del sidebar en pantallas ≥768px.
- **Móvil intacto**: por debajo de `md` nada cambia — feed centrado de 600px
  con bottom nav, exactamente igual que antes del fix.
- **Cero cambios de lógica**: un solo archivo CSS modificado; sin cambios en
  componentes, tipos ni tests de comportamiento.
- **Contenido ancho respira mejor**: tablas y listas amplias (p. ej. listados
  de admin, historial) disponen de más espacio horizontal en desktop.

### Negativas / Deuda técnica

- **ADR-001 queda desactualizado** en su descripción del ancho del feed para
  desktop: documenta `.feed-container` con `max-w-[600px]` como ancho general
  (líneas 71 y 136). No se modifica el ADR-001 (política del repo: los ADR son
  inmutables); este documento actúa como la referencia que lo supersede para el
  caso desktop.
- **Muy alta resolución**: en monitores muy anchos, las líneas de texto pueden
  quedar excesivamente largas en las páginas que no definen sus propios `max-w`
  internos (la única página con límite propio es `/notifications` con su
  `max-w-3xl`). **Revisión visual pendiente por humano**; si alguna página
  concreta lo necesita, se le añadirá un `max-w` interno en un fix posterior
  (fuera del alcance de este ADR).

---

## Archivos

| Archivo | Acción |
|---------|--------|
| `src/app/globals.css` | MODIFY — `.feed-container` (capa `@layer components`): añadido `md:max-w-none` al `@apply mx-auto w-full max-w-[600px]` existente; nada más en el archivo |

---

## Estado

- Fix implementado en el working tree: `src/app/globals.css` es el único
  archivo tocado (el cambio ya está aplicado en la rama de trabajo
  `fix/desktop-full-width-pages` del task file; PR posterior según
  `docs/git-conventions.md`).
- Verificación automatizada: **1013 tests pasando**, typecheck y lint limpios
  (el cambio es CSS puro; sin deltas esperados en la suite de tests).
- **Verificación manual pendiente de humano** antes de cerrar el PR: en
  desktop (≥768px) las páginas autenticadas ocupan todo el ancho; en móvil
  (<768px) la columna centrada de 600px se mantiene sin cambios.

---

## Referencias

- Task file: `tasks/fix-desktop-full-width.json` (criterios de aceptación, DoD
  — incluye este ADR como entregable; rama `fix/desktop-full-width-pages`;
  nota: `.feed-container` solo se usa en `app-shell.tsx` y `/notifications`
  conserva su `max-w-3xl` a propósito).
- ADR-001 (`docs/adr-sprint-01-ui-redesign.md`): origen de `.feed-container`
  (línea 71: "centered wrapper with max-w-[600px] (X/Twitter feed width)" y
  línea 136: "uses feed-container width") — su descripción del width del feed
  para desktop queda supersedida por este ADR.
- `src/app/globals.css` — definición de `.feed-container` en `@layer
  components` (el único archivo modificado por el fix).
- `src/components/layout/app-shell.tsx` — único consumidor de
  `.feed-container` (`<main className="md:pl-sidebar pb-16 md:pb-0">` +
  wrapper `feed-container px-4 py-4 sm:px-6 sm:py-6`).
- `src/app/notifications/page.tsx` — página con `max-w-3xl` propio anidado,
  fuera del alcance del fix.
- `docs/git-conventions.md` — §3.3 regla 5: ADR obligatorio para toda tarea de
  implementación; convención de rama `fix/...` (§1.2).