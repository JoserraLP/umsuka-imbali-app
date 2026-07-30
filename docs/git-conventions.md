# Git Conventions — Umsuka Imbali App

> **Propósito:** Establecer un estándar uniforme para que **todos los agentes del sistema**
> (SDD Master, Publisher, Task Architect, TDD-DDD Architect, QA Reviewer, Security Champion,
> Documentation Sync) usen el mismo formato al crear ramas, redactar commits y generar
> Pull Requests. Este documento es la única fuente de verdad para el estilo de Git.

---

## 1. Ramas (Branches)

### 1.1. Convención de nombres

Toda rama debe seguir el patrón:

```
<type>/<sprint-prefix?><kebab-case-description>
```

| Componente | Valores permitidos | Descripción |
|------------|-------------------|-------------|
| `type` | `feature`, `fix`, `docs`, `chore`, `refactor` | El tipo de cambio. **Obligatorio.** |
| `sprint-prefix` | `sprint-NN-` (ej. `sprint-07-`) | Prefijo opcional para cambios ligados a un sprint. |
| `description` | texto en `kebab-case` | Describe brevemente el cambio. **Obligatorio.** |

**Ejemplos:**

| Tipo | Rama |
|------|------|
| Feature | `feature/sprint-08-eventos-calendario` |
| Feature (sin sprint) | `feature/exportar-reporte-pdf` |
| Fix | `fix/sprint-05-security-audit` |
| Fix | `fix/login-error-503` |
| Docs | `docs/sprint-03-double-login-fix` |
| Chore | `chore/actualizar-dependencias-npm` |
| Refactor | `refactor/unificar-servicios-auth` |

### 1.2. Reglas de ramas

1. **Siempre crear la rama desde `master`** (a menos que se indique lo contrario).
2. **No usar caracteres especiales** (acentos, ñ, espacios, mayúsculas). Solo `[a-z0-9-/]`.
3. **Mantener nombres cortos** pero descriptivos (idealmente ≤ 50 caracteres).
4. **Una rama por tarea.** No mezclar cambios no relacionados en la misma rama.
5. **Eliminar la rama remota después del merge** para mantener limpio el repositorio.

### 1.3. Ciclo de vida típico

```
$ git checkout master
$ git pull origin master
$ git checkout -b feature/sprint-08-eventos-calendario
  ... (commits de implementación) ...
$ git push -u origin feature/sprint-08-eventos-calendario
  ... (PR → merge a master) ...
$ git branch -d feature/sprint-08-eventos-calendario                     # local
$ git push origin --delete feature/sprint-08-eventos-calendario          # remota
```

---

## 2. Commits

### 2.1. Formato del mensaje

Usamos **Commits Semánticos** (Conventional Commits), con el siguiente formato:

```
<type>(<optional-scope>): <subject>
```

- **type** — El tipo de cambio (obligatorio).
- **scope** — Contexto opcional (ej. `sprint-7`, `admin`, `auth`, `profile`).
- **subject** — Descripción breve en **imperativo, presente, minúscula** (sin punto final).

### 2.2. Tipos permitidos

| Tipo | Cuándo usarlo |
|------|---------------|
| `feat` | Nueva funcionalidad para el usuario final |
| `fix` | Corrección de un bug |
| `docs` | Cambios exclusivos en documentación (ADR, README, etc.) |
| `refactor` | Reestructuración de código sin cambio funcional |
| `chore` | Tareas de mantenimiento (deps, configs, CI, etc.) |
| `test` | Adición o modificación de tests |
| `perf` | Mejora de rendimiento |
| `style` | Cambios de formato, linting, whitespace (sin lógica) |
| `ci` | Cambios en pipelines de CI/CD |
| `revert` | Reversión de un commit anterior |

### 2.3. Reglas del subject

- **Idioma:** Usar **inglés** preferentemente. Si el equipo es hispanohablante, se permite español.
  En la práctica, este proyecto usa una mezcla; priorizar inglés pero no bloquear por idioma.
- **Imperativo presente:** `feat: add calendar widget` (NO `feat: added calendar widget`)
- **Máximo 72 caracteres** para el subject.
- **Sin punto final** al final del subject.
- **Minúscula** después del `:` (a menos que sea un nombre propio).

### 2.4. Cuerpo del commit (opcional)

Si el cambio requiere contexto adicional:

```
<type>(<scope>): <subject>

<explicación del por qué y qué, no del cómo>

<issue / ticket references>
```

- Separar el body del subject con una línea en blanco.
- Máximo 72 caracteres por línea.
- Explicar el **por qué** del cambio, no detallar cada línea modificada.

### 2.5. Ejemplos

```
feat(sprint-7): add emailless account creation for super admin
fix: replace PostgREST table ops with SECURITY DEFINER function
chore: remove debug logs from auth callback route
refactor: replace CHECK constraint with PostgreSQL ENUM for workgroup
docs(sprint-3): add ADR and E2E tests for double-login fix
test: add unit tests for emailless schema and alias generation
```

### 2.6. Contraejemplos (NO hacer)

```
❌ Implemented new feature                      # pasado, no imperativo
❌ feat: Implemented new feature                 # pasado + mayúscula
❌ feat(sprint-7):                              # vacío, sin descripción
❌ arreglado bug de login                        # español en pasado + sin type
❌ chore: actualizar dependencias                # buena práctica pero acento
❌ fix: a very long message that exceeds seventy two characters in total and should be shortened
❌ agregados cambios varios                      # vago, no informativo
```

---

## 3. Pull Requests

### 3.1. Título del PR

Formato:

```
[<type>] <Sprint X — ><Descripción breve>
```

| Elemento | Ejemplo |
|----------|---------|
| `[feature]` | `[feature] Sprint 7 — Creación de cuentas sin correo electrónico` |
| `[fix]` | `[fix] Replace PostgREST ops with SECURITY DEFINER function` |
| `[docs]` | `[docs] Sprint 3 — Documentación doble login` |
| `[chore]` | `[chore] Update npm dependencies` |

### 3.2. Cuerpo del PR

Debe incluir **exactamente** estas secciones, en este orden:

```markdown
## Summary

<Resumen conciso de los cambios, máximo 3-4 líneas. Explicar QUÉ se hizo y POR QUÉ.>

## Related Task

**Task:** `<título de la tarea>` (ver `tasks/<archivo>.json`)
**Acceptance Criteria:**
- <criterio 1>
- <criterio 2>

## Changes

- `<archivo/modificado>` — <breve descripción del cambio>
- `<archivo/creado>` — <breve descripción del cambio>
- ...

## Testing

- [ ] Tests unitarios: `npx vitest run <archivo>`
- [ ] Tests de integración: `npx playwright test`
- [ ] Verificación manual: <instrucciones si aplica>

## ADR

Ver `docs/adr-<task-name>.md` para la decisión arquitectónica completa.

## Breaking Changes

- [ ] Sí (describir)
- [x] No
```

### 3.3. Reglas de PR

1. **Target:** Siempre `master` (a menos que se especifique otra rama base).
2. **Linter:** El PR no debe contener errores de ESLint/TypeScript.
3. **Tests:** Todos los tests deben pasar antes de crear el PR.
4. **Security:** El escaneo de seguridad (security-champion) debe estar **limpio** sin hallazgos HIGH.
5. **ADR:** Toda tarea de implementación debe tener su ADR correspondiente en `docs/`.
6. **Autoreview:** El autor del PR debe revisar su propio diff antes de publicar.
7. **Draft PRs:** Usar PR en Draft si el trabajo está en progreso. Cambiar a "Ready for Review" cuando esté completo.

### 3.4. Flujo de creación (para el agente Publisher)

El agente Publisher sigue estos pasos exactos:

1. **Contexto:** Leer el último task file (`ls -t tasks/*.json | head -1`) y el ADR asociado.
2. **Branch:** Crear rama según convención (sección 1).
3. **Commit:** Hacer `git add .` + `git commit -m "<mensaje según sección 2>"`.
4. **Push:** `git push -u origin <branch-name>`.
5. **PR Body:** Componer usando las secciones de 3.2.
6. **Crear PR:** `gh pr create --title "<title según 3.1>" --body "<body>"`.
7. **Reportar:** Devolver la URL del PR.

---

## 4. Ejemplo completo

**Task:** `tasks/sprint-07-emailless-accounts.json`

### Branch

```
feature/sprint-07-emailless-accounts
```

### Commits (durante el desarrollo)

```
feat(sprint-7): add auth_method enum and username column to profiles
feat(sprint-7): add email_aliases table with RLS policies
feat(sprint-7): implement createEmaillessAccount service
feat(sprint-7): implement loginWithUsername resolver
feat(sprint-7): add emailless account creation UI for admin
fix: grant service_role INSERT/UPDATE/DELETE on profiles and email_aliases
fix: replace PostgREST table ops with SECURITY DEFINER function
chore: remove debug logs from auth callback route
```

### PR

**Title:** `[feature] Sprint 7 — Creación de cuentas sin correo electrónico (emailless accounts)`

**Body:**
```markdown
## Summary

Implementa la creación de cuentas sin correo electrónico para menores/miembros
sin email. El super admin puede dar de alta usuarios con username + contraseña,
y el sistema genera internamente un email alias (user-{uuid}@umsuka.internal)
para compatibilidad con Supabase Auth.

## Related Task

**Task:** Sprint 7 — Creación de Cuentas sin Correo Electrónico (Super Admin)
**Acceptance Criteria:**
- El super admin puede crear una cuenta para un menor/miembro sin email.
- El sistema genera un email alias único interno.
- El nuevo miembro puede iniciar sesión con username + contraseña.
- ...

## Changes

- `supabase/migrations/20260101002800_auth_method_enum.sql` — CREATE
- `supabase/migrations/20260101002900_email_aliases_rls.sql` — CREATE
- `src/lib/auth/admin-create.ts` — CREATE
- `src/lib/auth/emailless-login.ts` — CREATE
- `src/lib/auth/session.ts` — MODIFY (set email=null for email_alias)
- `src/app/admin/users/emailless-account-form.tsx` — CREATE
- ...

## Testing

- [x] Tests unitarios: `npx vitest run tests/unit/lib/emailless-schema.test.ts`
- [x] Tests unitarios: `npx vitest run tests/unit/lib/admin-create.test.ts`
- [x] Verificación manual: Crear cuenta desde /admin/users e iniciar sesión

## ADR

Ver `docs/adr-sprint-07-emailless-accounts.md`

## Breaking Changes

- [ ] Sí
- [x] No
```

---

## 5. Checklist para agentes

Antes de que cualquier agente genere un commit, rama o PR, debe verificar:

- [ ] **Branch name** sigue el patrón `<type>/<kebab-case-description>`.
- [ ] **Commit message** usa formato `<type>(<scope>): <subject>` con subject en imperativo presente.
- [ ] **PR title** usa `[<type>] <descripción>`.
- [ ] **PR body** tiene todas las secciones requeridas (Summary, Related Task, Changes, Testing, ADR, Breaking Changes).
- [ ] **No hay secretos** expuestos (API keys, .env, service role keys, etc.).
- [ ] **No hay cambios no relacionados** mezclados en la misma rama/PR.
- [ ] **Tests pasan** antes del PR.
- [ ] **ADR existe** para tareas de implementación.

---

## 6. Referencias

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
- ADRs del proyecto: `docs/adr-*.md`
- Tareas: `tasks/*.json`
- Configuración de agentes: `.opencode/agents/*.md`
