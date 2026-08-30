# Plan de Desarrollo — UMSUKA Imbali App

> **Fecha:** 2026-07-28
> **Propósito:** Hoja de ruta completa para la implementación de todas las funcionalidades pendientes, organizada por sprints con sus ramas asociadas, dependencias y criterios de aceptación.

---

## Convención de Ramas

| Tipo | Formato | Rama base |
|---|---|---|
| Feature | `feature/<sprint>-<nombre-corto>` | `develop` |
| Bugfix | `fix/<descripcion>` | `develop` |
| Hotfix | `hotfix/<descripcion>` | `main` |
| Release | `release/<version>` | `develop` |

**Flujo:** `feature/*` → PR → `develop` → PR → `main` → Deploy automático a Vercel

---

## Sprint 1 — Mejora de Interfaz Gráfica (UI/UX)

**Rama:** `feature/sprint-01-ui-redesign`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-01-ui-redesign.json` y `docs/adr-sprint-01-ui-redesign.md`.

### Descripción
Rediseñar la interfaz gráfica actual para adoptar un estilo visual moderno inspirado en X/Twitter y redes sociales actuales. Incluye sistema de temas, tipografía, espaciado, componentes visuales y experiencia de navegación mobile-first.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Auditoría visual actual | Revisar componentes existentes en `src/components/ui/` y layout actual. Identificar brechas con el diseño objetivo. |
| 2 | Definir Design Tokens | Crear/actualizar `tailwind.config.ts` con colores de marca, fuentes, radios de borde, sombras y espaciados consistentes con una red social moderna. |
| 3 | Rediseñar layout base | Actualizar `src/app/layout.tsx` y `src/components/layout/` para incluir: header con navegación tipo X/Twitter sidebar, menú inferior para mobile, y contenedor principal con ancho máximo tipo feed. |
| 4 | Crear componentes de feed | Implementar componentes reutilizables: `PostCard`, `FeedList`, `Avatar`, `Badge`, `FollowButton` (según aplique). |
| 5 | Adaptar páginas existentes | Refactorizar `dashboard/page.tsx`, `events/`, `profile/` para usar los nuevos componentes de layout y diseño. |
| 6 | Responsive y mobile-first | Asegurar que todas las páginas se vean correctamente en móvil, tablet y escritorio. |
| 7 | Modo oscuro/claro | Integrar con `next-themes` (ya en dependencias) para soporte de tema claro/oscuro. |
| 8 | Pruebas visuales | Verificar coherencia visual en todos los breakpoints. |

### Criterios de Aceptación
- El layout principal imita la estructura de una red social moderna (sidebar de navegación, feed central, panel de tendencias/notificaciones).
- Todos los componentes de ShadCN/UI están consistentemente estilizados.
- La navegación funciona correctamente en mobile (bottom nav) y desktop (sidebar).
- El modo oscuro/claro funciona sin errores.
- No hay regresiones visuales en páginas existentes.

---

## Sprint 2 — Roles de Responsables de Grupos de Trabajo

**Rama:** `feature/sprint-02-workgroup-roles`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-02-workgroup-roles.json` y `docs/adr-sprint-02-workgroup-roles.md`.

### Descripción
Añadir roles específicos de responsable para grupos de trabajo (telas, barra, estandarte, limpieza). Solo estos responsables podrán registrar si una persona ha participado o no en su turno de trabajo. Además, los responsables pueden crear eventos de tipo "asistencia a turno de trabajo" donde se marca quién cumplió su turno.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columna `workgroup` a `umsuka.profiles` (tipo ENUM: `telas`, `barra`, `estandarte`, `limpieza`, `ninguno`). Añadir columna `is_workgroup_lead` booleana. Crear índices. |
| 2 | Migración de BD — tabla workgroup_attendance | Crear `umsuka.workgroup_attendance` (id, shift_id, user_id, workgroup, attended, marked_by, timestamps) con RLS. |
| 3 | Migración ENUM workgroup | Crear tipo ENUM `umsuka.workgroup` reemplazando el CHECK constraint en profiles. |
| 4 | Migración event_type work_shift | Añadir `'work_shift'` como tipo de evento válido. Políticas RLS para que los responsables de grupo puedan crear/editar/eliminar sus propios eventos de tipo trabajo. |
| 5 | Helper functions | Añadir `umsuka.is_workgroup_lead(workgroup text)`, `umsuka.current_user_workgroup()` y `umsuka.is_super_admin()` en SQL. |
| 6 | Actualizar tipos | Regenerar `src/types/database.types.ts` con `supabase gen types`. |
| 7 | Capa de negocio `lib/workgroups/` | Crear schemas Zod, queries y mutations para la gestión de asistencia por grupo de trabajo. |
| 8 | Server actions | Acciones para marcar/desmarcar asistencia de miembros en un turno, validando que el actor sea el lead del grupo correspondiente. |
| 9 | UI de gestión de asistencia | Panel en la página de evento/detalle de turno donde el responsable pueda ver los miembros de su grupo y marcar asistencia. |
| 10 | Evento de tipo work_shift | Los responsables de grupo pueden crear eventos de tipo "asistencia a turno de trabajo". Al crearlos se auto-genera un turno. La página de detalle del evento muestra el panel de asistencia por grupo de trabajo. |
| 11 | Actualizar políticas RLS | Asegurar que `workgroup_attendance` solo sea visible/editable por el lead del grupo correspondiente + super_admin. |

### Dependencias
- Sprint 1 (UI/UX para los nuevos paneles)

### Criterios de Aceptación
- Existe el rol de "responsable de telas", "responsable de barra", "responsable de estandarte", "responsable de limpieza".
- Solo el responsable de un grupo puede marcar asistencia para los miembros de su grupo.
- Un responsable no puede marcar asistencia para miembros de otros grupos.
- Super admin puede ver y gestionar todos los grupos.
- Los responsables de grupo pueden crear eventos de tipo "asistencia a turno de trabajo".
- Al crear un evento de tipo trabajo, se genera automáticamente un turno asociado.
- La página de detalle del evento de trabajo muestra el panel de asistencia por grupo.

---

## Sprint 3 — Responsables de Barra: Gestión de Precios

**Rama:** `feature/sprint-03-bar-pricing`

### Descripción
Los responsables de barra (rol `workgroup_lead` con `workgroup = 'barra'`) podrán modificar la lista de precios de los objetos a la venta.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.bar_items` (id, name, description, price, is_available, created_at, updated_at). Crear `umsuka.bar_price_history` para auditoría de cambios de precio. |
| 2 | RLS | Solo responsables de barra y super_admin pueden insertar/update/delete. Todos los auth users pueden select. |
| 3 | Capa de negocio `lib/bar/` | Schemas Zod (createBarItemSchema, updatePriceSchema), queries (getBarItems, getPriceHistory), mutations (createItem, updatePrice, toggleAvailability). |
| 4 | Server actions | Wrappers thin con revalidación de path. |
| 5 | UI de gestión de precios | Panel tipo "menú del día" donde el responsable de barra pueda: ver items, editar precio, activar/desactivar items, ver histórico. |
| 6 | UI pública | Página pública de lista de precios visible para todos los miembros autenticados. |
| 7 | Pruebas | Tests unitarios para schemas, tests de integración para acciones. |

### Dependencias
- Sprint 2 (para validar el rol de responsable de barra)

### Criterios de Aceptación
- Solo el responsable de barra y super_admin pueden modificar precios.
- Todos los usuarios autenticados pueden ver la lista de precios.
- Cada cambio de precio queda registrado en el histórico con timestamp y responsable.
- Se pueden activar/desactivar items (sin eliminar).

---

## Sprint 4 — Página Principal: Feed de Instagram, Notificaciones y Calendario

**Rama:** `feature/sprint-04-home-feed`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-04-home-feed.json` y `docs/adr-sprint-04-home-feed.md`.

### Descripción
Rediseñar la página principal (`/dashboard`) para mostrar: feed de los últimos posts de Instagram de la cuenta oficial de Umsuka, notificaciones del usuario y eventos próximos del calendario.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Integración Instagram API | Crear servicio `src/lib/social/instagram.ts` que obtenga los últimos posts usando Instagram Basic Display API o Graph API. |
| 2 | Caché de posts | Almacenar posts en Supabase (`umsuka.instagram_posts`) con TTL para evitar rate limiting. |
| 3 | Server component de feed | Crear `InstagramFeed` que renderice los últimos 6-9 posts en cuadrícula. |
| 4 | Widget de notificaciones | Consultar `umsuka.notifications` (a implementar en Sprint 20) y mostrar las últimas 5 no leídas. |
| 5 | Widget de calendario | Consultar `umsuka.events` ordenados por fecha ascendente, mostrar los próximos 3-5 eventos. |
| 6 | Diseño de dashboard | Maquetar las 3 secciones en columnas: feed central (Instagram), sidebar derecha (notificaciones + calendario). |
| 7 | Actualizar `dashboard/page.tsx` | Refactorizar para usar los nuevos widgets. |
| 8 | Pruebas | Tests de integración para cada widget. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 20 (Notificaciones) — si se quiere integración real; si no, se puede hacer primero con datos mock.

### Criterios de Aceptación
- La página principal muestra los últimos posts de Instagram de @umsuka (o cuenta configurada).
- Las notificaciones del usuario se muestran con indicador de no leídas.
- Los próximos eventos del calendario aparecen ordenados por fecha.
- El diseño es responsive y coherente con el rediseño de UI.

---

## Sprint 5 — Asistencia y Ausencias

**Rama:** `feature/sprint-05-asistencia-ausencias`

### Descripción
Gestión completa de asistencia a eventos: marcar asistencia, historial, solicitudes de ausencia justificada.

### Estado
✅ **Ya implementado.** Ver `tasks/sprint-05-asistencia-ausencias.json` y `docs/adr-sprint-05-asistencia-ausencias.md`.

### Resumen de lo implementado
- Módulo `src/lib/attendance/` con schemas, queries y mutations.
- Módulo `src/lib/absences/` con schemas, queries y mutations.
- Server actions para attendance y absences.
- Paneles UI en página de detalle de evento (`AttendancePanel`, `AbsencePanel`).
- Página de historial en `/profile/history`.
- Tests unitarios (29 tests).
- Políticas RLS existentes respetadas.

---

## Sprint 6 — Confirmación de Super Admin en Registro

**Rama:** `feature/sprint-06-registration-approval`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-06-registration-approval.json` y `docs/adr-sprint-06-registration-approval.md`.

### Descripción
Implementar un flujo donde cada nuevo usuario que se registra (vía Google OAuth) queda en estado "pendiente de aprobación" hasta que un super admin lo active explícitamente.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columna `status` a `umsuka.profiles` (enum: `pending`, `active`, `suspended`). Default `pending`. Actualizar trigger `handle_new_user()`. |
| 2 | Actualizar RLS | Los usuarios con status `pending` solo pueden ver su propio perfil. No pueden acceder a eventos, turnos, etc. |
| 3 | Middleware update | En `middleware.ts`, si el perfil está `pending`, redirigir a una página de "pendiente de aprobación". |
| 4 | UI de pending | Página `/auth/pending` con mensaje informativo. |
| 5 | Panel de administración | En `/admin/users`, añadir columna de status y botones "Aprobar"/"Suspender". |
| 6 | Server actions | `approveUserAction`, `suspendUserAction` — solo super_admin. |
| 7 | Notificación al usuario | Opcional: enviar notificación interna cuando el usuario sea aprobado (depende de Sprint 20). |
| 8 | Pruebas | Tests de integración para el flujo completo de aprobación. |

### Dependencias
- Sprint 5 (para tener el panel admin funcional)

### Criterios de Aceptación
- Al registrarse con Google, el perfil se crea con status `pending`.
- El usuario pendiente ve una pantalla informativa y no puede acceder a ninguna funcionalidad.
- Un super admin puede aprobar o suspender usuarios desde el panel de administración.
- Al ser aprobado, el usuario puede acceder a la aplicación normalmente.

---

## Sprint 7 — Creación de Cuentas sin Correo Electrónico (Super Admin)

**Rama:** `feature/sprint-07-emailless-accounts`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-07-emailless-accounts.json` y `docs/adr-sprint-07-emailless-accounts.md`.

### Descripción
El super admin puede dar de alta a nuevos miembros en la aplicación sin necesidad de que estos tengan una cuenta de correo electrónico (por ejemplo, menores de edad). El sistema genera internamente un identificador único (email alias) que Supabase Auth utiliza como email, y el usuario accede con un nombre de usuario y contraseña proporcionados por el super admin.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Diseño de la solución | Decidir estrategia: (A) email alias autogenerado (`user-{uuid}@umsuka.internal`) + contraseña, o (B) usar `phone` como identificador alternativo en Supabase Auth. Se recomienda la opción (A) por compatibilidad con el esquema actual. |
| 2 | Migración de BD — profiles | Añadir columna `username` única y opcional a `umsuka.profiles` para que estos usuarios puedan identificarse sin email. Añadir columna `auth_method` (`google`, `email_alias`, `phone`). |
| 3 | Migración de BD — email_aliases | Crear tabla `umsuka.email_aliases` (id, profile_id, alias_email text UNIQUE, created_by, created_at) para llevar registro de los alias generados. |
| 4 | Servicio `lib/auth/admin-create.ts` | Implementar función `createEmaillessAccount(data)` que: genere un alias UUID, llame a `supabase.auth.admin.createUser()` con el alias y contraseña, cree el perfil con `auth_method = 'email_alias'`, y registre el alias en la tabla de aliases. |
| 5 | Servicio `lib/auth/emailless-login.ts` | Implementar función `loginWithUsername(username, password)` que resuelva el `username` al `alias_email` (o al `id` de auth) y delegue en `signInWithPassword()`. |
| 6 | Server actions | `createEmaillessAccountAction` (solo super_admin) y `emaillessLoginAction` (público, para estos usuarios). |
| 7 | UI: Formulario de creación | En `/admin/users`, formulario con campos: nombre, apellidos, nombre de usuario, contraseña, componente, grupo de trabajo. El sistema genera automáticamente el email alias en segundo plano. |
| 8 | UI: Pantalla de confirmación | Tras crear la cuenta, mostrar al super admin las credenciales generadas (username + contraseña) para que las entregue al nuevo miembro. Advertencia de seguridad: "Cambia la contraseña en el primer inicio de sesión." |
| 9 | UI: Login para emailless | En `/auth/login`, añadir pestaña "Acceder con usuario y contraseña" además del botón de Google. Validar que el método de auth del perfil sea `email_alias`. |
| 10 | UI: Cambio de contraseña | En `/profile`, añadir opción "Cambiar contraseña" para estos usuarios (usa `supabase.auth.updateUser()`). |
| 11 | Middleware update | Asegurar que `middleware.ts` maneje correctamente sesiones de usuarios con `auth_method = 'email_alias'`. |
| 12 | Backfill de RLS | Verificar que las políticas RLS existentes no dependan exclusivamente del email (ninguna debería). |
| 13 | Pruebas | Tests unitarios para generación de alias, creación de cuenta, login con username. Tests de integración del flujo completo. |

### Dependencias
- Sprint 6 (aprobación de usuarios + panel admin funcional)
- Sprint 19 (perfiles con campos completos como username)

### Criterios de Aceptación
- El super admin puede crear una cuenta para un menor/miembro sin email desde el panel de administración.
- El sistema genera un email alias único interno (`user-{uuid}@umsuka.internal`) que nunca se muestra al usuario.
- El nuevo miembro puede iniciar sesión con su nombre de usuario + contraseña desde la página de login.
- Las cuentas creadas sin email pasan por el mismo flujo de aprobación (Sprint 6): nacen en estado `pending`.
- El super admin recibe un resumen con las credenciales para entregar al miembro.
- El email alias generado no es accesible ni visible para ningún usuario (ni siquiera el propio miembro).
- No se rompe el login existente con Google OAuth.
- Todos los usuarios, independientemente de su método de auth, tienen las mismas capacidades dentro de la app.

---

## Sprint 8 — Turnos: Creación, Asignación y Control de Conflictos

**Rama:** `feature/sprint-08-shifts`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-08-shifts.json` y `docs/adr-sprint-08-shifts.md`.

### Descripción
Crear y administrar turnos asociados a eventos, incluyendo asignación de miembros a turnos y control de conflictos (horarios solapados).

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Las tablas `umsuka.shifts` y `umsuka.shift_assignments` ya existen. Revisar si hacen falta columnas adicionales (ej. `max_assignees`, `workgroup`). |
| 2 | Mejorar capa `lib/shifts/` | Crear schemas Zod, queries y mutations completos (los que falten). |
| 3 | Lógica de detección de conflictos | Implementar función `checkShiftConflicts(userId, startTime, endTime)` que detecte solapamientos con turnos existentes del miembro. |
| 4 | Server actions | `createShiftAction`, `assignMemberAction`, `unassignMemberAction`, `getConflictsAction`. |
| 5 | UI de gestión de turnos | Página dentro del evento para crear/editar/eliminar turnos, asignar/desasignar miembros, ver conflictos. |
| 6 | Calendario visual | Vista de turnos en línea temporal (timeline) para ver solapamientos gráficamente. |
| 7 | Mi vista de turnos | Página `/profile/shifts` donde el miembro ve sus turnos asignados. |
| 8 | Pruebas | Tests unitarios para detección de conflictos, tests de integración. |

### Dependencias
- Sprint 1 (UI/UX para la línea temporal)
- Sprint 6 (Registration Approval — para tener management roles claros)

### Criterios de Aceptación
- Los management pueden crear turnos asociados a un evento con hora de inicio y fin.
- Los management pueden asignar miembros a turnos.
- El sistema detecta y advierte sobre conflictos horarios al asignar un miembro.
- Los miembros pueden ver sus turnos asignados en su perfil.
- No se puede asignar a un miembro a dos turnos que solapen.

---

## Sprint 9 — Validación y Almacenamiento Seguro de Contraseñas

**Rama (histórica):** `feature/sprint-11-password-validation`

### Estado
✅ **Ejecutado.** Rama histórica del sprint completado (la rama real ya existe con este nombre).

### Descripción
Implementar la comprobación y almacenamiento seguro de contraseñas para los usuarios creados sin correo electrónico (Sprint 7). Actualmente el login con usuario/contraseña no puede verificar si las credenciales introducidas son válidas porque el flujo de autenticación mediante Supabase Auth no está correctamente integrado. Este sprint completa la funcionalidad pendiente del Sprint 7 y asegura que las contraseñas se almacenen de forma segura (hash + salt) y se verifiquen correctamente en cada inicio de sesión.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Auditoría del estado actual | Revisar la implementación del Sprint 7: cómo se crean las cuentas con `supabase.auth.admin.createUser()`, cómo se almacena la contraseña, y cómo funciona el login con `signInWithPassword()`. Identificar la causa raíz de por qué no se pueden validar las credenciales. |
| 2 | Migración de BD — password_attempts | Crear `umsuka.password_attempts` (id, profile_id, attempted_at, success, ip_address) para registrar intentos de login y prevenir fuerza bruta. |
| 3 | Migración de BD — password_reset_tokens | Crear `umsuka.password_reset_tokens` (id, profile_id, token_hash, expires_at, used) para gestión de restablecimiento de contraseña. |
| 4 | Servicio `lib/auth/password-hash.ts` | Implementar o verificar que Supabase Auth ya aplica bcrypt/hash a las contraseñas. Si no es así, implementar hash con `bcryptjs` o similar antes de enviar a Supabase. |
| 5 | Servicio `lib/auth/emailless-login.ts` — corregir | Refactorizar `loginWithUsername()` para que: (1) busque el username en profiles, (2) resuelva el email alias asociado, (3) llame a `signInWithPassword()` con el email alias y la contraseña proporcionada, (4) capture y devuelva errores específicos (credenciales inválidas, cuenta no aprobada, cuenta suspendida). |
| 6 | Servicio `lib/auth/password-reset.ts` | Implementar flujo de restablecimiento de contraseña para usuarios sin email: (1) el super admin genera un token de reset desde el panel, (2) se muestra al admin un enlace/código temporal, (3) el usuario ingresa el código en una página `/auth/reset-password` y crea una nueva contraseña. |
| 7 | Server actions | `loginWithPasswordAction` (devuelve errores específicos), `resetPasswordAction`, `changePasswordAction`. |
| 8 | UI: Página de login con feedback | Mejorar la pestaña "Acceder con usuario y contraseña" para mostrar mensajes de error específicos: "Usuario no encontrado", "Contraseña incorrecta", "Cuenta pendiente de aprobación", "Cuenta suspendida", "Demasiados intentos. Intente de nuevo en X minutos". |
| 9 | UI: Restablecer contraseña | Página `/auth/reset-password` con formulario para ingresar token temporal y nueva contraseña (con confirmación y validación de fortaleza). |
| 10 | UI: Panel admin — reset de contraseña | En `/admin/users`, botón "Restablecer contraseña" que genera un token temporal y lo muestra al admin para entregar al usuario. |
| 11 | Protección contra fuerza bruta | Implementar rate limiting: después de 5 intentos fallidos en 15 minutos, bloquear el inicio de sesión por 30 minutos. Usar la tabla `password_attempts` para tracking. |
| 12 | Validación de fortaleza de contraseña | Al crear/restablecer contraseña, validar: mínimo 8 caracteres, al menos una mayúscula, una minúscula, un número y un carácter especial. Usar Zod schema. |
| 13 | Pruebas | Tests unitarios para hashing, validación de fortaleza, rate limiting. Tests de integración para login exitoso/fallido, restablecimiento de contraseña. |

### Dependencias
- Sprint 7 (Emailless Accounts — para tener el sistema de cuentas sin email)
- Sprint 6 (Registration Approval — para la aprobación de cuentas)

### Criterios de Aceptación
- El login con usuario/contraseña verifica correctamente las credenciales contra Supabase Auth.
- Los mensajes de error diferenciados indican la causa exacta del fallo de login.
- Las contraseñas se almacenan con hash seguro (bcrypt o el mecanismo nativo de Supabase Auth).
- Existe un flujo de restablecimiento de contraseña mediante token temporal generado por el super admin.
- La fortaleza de la contraseña se valida al crearla o cambiarla.
- El sistema bloquea temporalmente el login tras 5 intentos fallidos en 15 minutos.
- Todos los tests de seguridad pasan sin hallazgos HIGH.

---

## Sprint 10 — Noticias: Publicación y Gestión

**Rama (histórica):** `feature/sprint-13-news`

### Estado
✅ **Ejecutado.** Rama histórica del sprint completado (la rama real ya existe con este nombre).

### Descripción
Sistema de publicación y gestión de noticias internas para los miembros.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | La tabla `umsuka.news` ya existe. Revisar si necesita columnas adicionales (ej. `image_url`, `published`, `pinned`). |
| 2 | Capa `lib/news/` | Schemas Zod, queries (getNewsFeed, getNewsById, getPinnedNews), mutations (createNews, updateNews, deleteNews, togglePin). |
| 3 | Server actions | Wrappers con revalidación. |
| 4 | UI: Feed de noticias | Página `/news` con lista de noticias estilo red social (tarjetas con título, contenido truncado, autor, fecha). |
| 5 | UI: Detalle de noticia | Página `/news/[id]` con contenido completo. |
| 6 | UI: Crear/Editar noticia | Formulario para management, con editor de texto enriquecido (opcional). |
| 7 | Notificaciones | Al crear una noticia, enviar notificación push/Interna a todos los miembros (depende de Sprint 20). |
| 8 | Pruebas | Tests unitarios e integración. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 20 (Notificaciones — opcional para MVP)

### Criterios de Aceptación
- Los management pueden crear, editar y eliminar noticias.
- Todos los miembros autenticados pueden ver las noticias.
- Las noticias se muestran ordenadas por fecha (más reciente primero).
- Las noticias importantes pueden fijarse al inicio.

---

## Sprint 11 — Preguntas: Consultas y Seguimiento

**Rama (histórica):** `feature/sprint-14-questions`

### Estado
✅ **Ejecutado.** Rama histórica del sprint completado (la rama real ya existe con este nombre).

### Descripción
Módulo para realizar consultas internas, hacer seguimiento y marcar preguntas como resueltas.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | La tabla `umsuka.questions` ya existe. Revisar si necesita columnas adicionales (ej. `category`, `priority`). |
| 2 | Capa `lib/questions/` | Schemas Zod (createQuestionSchema, resolveQuestionSchema, addCommentSchema), queries (getQuestions, getMyQuestions, getQuestionById), mutations. |
| 3 | Server actions | Acciones CRUD + marcar como resuelta. |
| 4 | UI: Lista de preguntas | Página `/questions` con filtros (abiertas/resueltas, categoría, mías). |
| 5 | UI: Detalle de pregunta | Página `/questions/[id]` con discusión/ comentarios. |
| 6 | UI: Crear pregunta | Formulario para cualquier miembro autenticado. |
| 7 | Notificaciones | Notificar al creador cuando su pregunta sea respondida o resuelta. |
| 8 | Pruebas | Tests unitarios e integración. |

### Dependencias
- Sprint 1 (UI/UX)

### Criterios de Aceptación
- Cualquier miembro autenticado puede crear una pregunta.
- Los management y el creador pueden marcar la pregunta como resuelta.
- Las preguntas tienen estado: abierta / resuelta.
- Se puede buscar y filtrar preguntas.

---

## Sprint 12 — Asociación de Personas a Turnos y Visibilidad por Grupo

**Rama (histórica):** `feature/sprint-12-shift-assignment-groups`

### Estado
✅ **Ejecutado.**

### Descripción
Permitir asociar personas concretas a cada turno de trabajo. Ya no se asume que todo el mundo del grupo (p. ej. toda la "barra") tiene que cubrir todos los turnos: cada turno se asigna a miembros específicos. Además, **solo los responsables de cada grupo de trabajo podrán crear sus propios eventos** de tipo trabajo, y **esos eventos solo serán visibles para los miembros que pertenecen a ese grupo**.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — shift_assignments | Revisar y completar `umsuka.shift_assignments` (id, shift_id, user_id, confirmed, created_by). Añadir índice único `(shift_id, user_id)` para evitar duplicados. |
| 2 | Migración de BD — visibilidad de eventos | Añadir a `umsuka.events` las columnas `visible_to_group` (workgroup o null = todos) y `created_by_workgroup` para eventos de tipo `work_shift`. |
| 3 | RLS — creación de eventos de grupo | Actualizar políticas para que solo `is_workgroup_lead(workgroup)` pueda INSERT/UPDATE/DELETE eventos de tipo `work_shift` donde `created_by_workgroup` coincida con su grupo. |
| 4 | RLS — visibilidad de eventos | Añadir política SELECT que filtre: eventos con `visible_to_group = null` (visibles para todos) o `visible_to_group = current_user_workgroup()`. |
| 5 | Actualizar tipos | Regenerar `src/types/database.types.ts`. |
| 6 | Capa `lib/shifts/assignments.ts` | Queries y mutations para asignar/desasignar miembros a turnos concretos: `assignMemberToShift`, `unassignMemberFromShift`, `getShiftAssignments`, `getMyAssignedShifts`. |
| 7 | Server actions | `assignMemberToShiftAction`, `unassignMemberFromShiftAction` — validan que el actor sea el lead del grupo del turno. |
| 8 | UI: Gestión de asignación | En el detalle del turno, lista de miembros del grupo con checkbox/toggle para asignarlos a ese turno concreto. |
| 9 | UI: Eventos por grupo | Al crear un evento de tipo trabajo, el responsable elige su grupo; el evento queda marcado con `visible_to_group` y solo lo ven los miembros de ese grupo. |
| 10 | Feed filtrado | En la página de eventos, los miembros solo ven: eventos generales + eventos de su grupo de trabajo. |
| 11 | Pruebas | Tests unitarios de RLS/visibilidad y de asignación. Tests de integración del flujo completo. |

### Dependencias
- Sprint 2 (Workgroup Roles — para `is_workgroup_lead` y `current_user_workgroup`)
- Sprint 8 (Shifts — para la gestión base de turnos)

### Criterios de Aceptación
- Cada turno tiene asignados miembros concretos (no todo el grupo).
- Solo el responsable del grupo puede crear eventos de tipo trabajo de su grupo.
- Los eventos de tipo trabajo solo son visibles para los miembros del grupo correspondiente.
- Un miembro no puede ver eventos de trabajo de otros grupos.
- Un responsable no puede asignar miembros a turnos de otros grupos.

---

## Sprint 13 — Estadísticas para Responsables de Grupo

**Rama:** `feature/sprint-13-workgroup-stats`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-13-workgroup-stats.json` y `docs/adr-sprint-13-workgroup-stats.md`.

### Descripción
Nueva sección para los responsables de cada grupo de trabajo donde pueden ver estadísticas de su grupo: asistencia a eventos de trabajo, horas echadas y número de turnos realizados por cada persona del grupo.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — horas por turno | Añadir a `umsuka.shifts` las columnas `duration_hours` (calculada de start/end) o confirmar que se calcula en runtime. Añadir índice en `shift_assignments.user_id`. |
| 2 | Capa `lib/workgroups/stats.ts` | Queries agregadas: `getGroupAttendanceStats(workgroup)`, `getGroupHoursStats(workgroup)`, `getMemberShiftCount(userId)`, `getMemberTotalHours(userId)`. |
| 3 | Cálculo de estadísticas | Para cada miembro del grupo: nº de turnos asignados, nº de turnos con asistencia confirmada (vía `workgroup_attendance`), horas totales (suma de `duration_hours` de turnos asistidos), porcentaje de asistencia. |
| 4 | Server actions | `getGroupStatsAction`, `getMemberStatsAction` — solo lead del grupo o super_admin. |
| 5 | UI: Sección de estadísticas | Página `/workgroups/[grupo]/stats` con: tabla resumen por miembro (nombre, turnos hechos, horas, % asistencia) y gráficos simples (barras por miembro, evolución semanal/mensual). |
| 6 | UI: Acceso desde dashboard | Enlace a la sección de estadísticas visible solo para responsables de grupo. |
| 7 | UI: Detalle por miembro | Al hacer clic en un miembro, ver su desglose: lista de turnos asistidos con fecha, evento y horas. |
| 8 | Pruebas | Tests unitarios para las queries agregadas y tests de integración. |

### Dependencias
- Sprint 12 (Asociación de personas a turnos — para tener asignaciones concretas)
- Sprint 2 (Workgroup Roles — para los leads de grupo)

### Criterios de Aceptación
- Cada responsable de grupo ve una sección de estadísticas exclusiva de su grupo.
- Se muestran por persona: nº de turnos hechos, horas totales y porcentaje de asistencia.
- El responsable solo ve datos de los miembros de su propio grupo.
- Super admin puede ver las estadísticas de todos los grupos.
- Los datos se actualizan al marcar asistencia en los turnos.

---

## Sprint 14 — Listado de Miembros para Directiva y Responsables de Grupo

**Rama (histórica):** `feature/sprint-14-member-list`

### Estado
✅ **Ejecutado.**

### Descripción
Sección donde la directiva y los responsables de cada grupo de trabajo pueden ver el listado de los usuarios dados de alta en la comparsa. La directiva (super admin/management) ve a todos los miembros; cada responsable de grupo ve únicamente los miembros de su propio grupo de trabajo.

> **Extensión (2026-08-13):** añade responsables de componente (música/baile) — columna `component_lead_for`, scope por componente en `/members` y designación solo por super admin en `/admin/users`. Ver `docs/adr-sprint-14-member-list.md`.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Capa `lib/members/` | Queries: `getAllMembers()` (solo directiva/super_admin), `getWorkgroupMembers(workgroup)` (solo lead de ese grupo), `getMemberDetail(userId)` con datos de perfil. |
| 2 | Server actions | `getMembersAction` con validación de rol: super_admin/management → todos los miembros; `is_workgroup_lead` → solo los de su grupo; resto → denegado. |
| 3 | RLS check | Verificar las políticas SELECT en `umsuka.profiles` para que un responsable no pueda leer miembros de otros grupos mediante las queries existentes. |
| 4 | UI: Página de listado | Página `/members` con tabla: nombre, componente, grupo de trabajo, rol, estado (pending/active/suspended), fecha de alta. Filtros por grupo, componente y estado, y búsqueda por nombre. |
| 5 | UI: Vista por grupo | Para los responsables de grupo, la misma página muestra únicamente los miembros de su grupo (filtrada por su `workgroup`). Enlace visible en el dashboard solo para directiva y leads. |
| 6 | UI: Detalle de miembro | Al hacer clic en un miembro, ver su ficha: datos de perfil, grupo de trabajo, turnos asignados y asistencia (reutilizando datos de sprints anteriores). |
| 7 | Pruebas | Tests unitarios de las queries y validaciones de rol. Tests de integración: directiva ve todos, lead ve solo su grupo, lead no puede ver otros grupos. |

### Dependencias
- Sprint 2 (Workgroup Roles — para `is_workgroup_lead` y `current_user_workgroup`)
- Sprint 19 (Perfiles y Componentes — para los campos completos del perfil)

### Criterios de Aceptación
- La directiva ve el listado de todos los usuarios dados de alta en la comparsa.
- Cada responsable de grupo ve únicamente los miembros de su grupo de trabajo.
- Un responsable no puede ver los miembros de otros grupos.
- El listado muestra nombre, componente, grupo, rol, estado y fecha de alta.
- Se puede buscar y filtrar por grupo, componente y estado.
- La directiva puede ver el listado completo y el de cualquier grupo.

---

## Sprint 15 — Votaciones

**Rama:** `feature/sprint-15-votings`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-15-votings.json` y `docs/adr-sprint-15-votings.md`.

### Descripción
Sistema de votación con opciones múltiples, control de voto único por usuario y visualización de resultados en tiempo real.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Las tablas `umsuka.votings`, `umsuka.voting_options` y `umsuka.voting_votes` ya existen. Revisar si hace falta `allow_multiple` o `voting_deadline`. |
| 2 | Capa `lib/votings/` | Schemas Zod, queries (getVotings, getVotingById, getResults), mutations (createVoting, addOption, castVote, closeVoting). |
| 3 | Control de voto único | Validar que un usuario no pueda votar dos veces en la misma votación (unique constraint en `voting_votes` por `voting_id + user_id`). |
| 4 | Server actions | Acciones con validación de rol (management para crear/cerrar, cualquier auth para votar). |
| 5 | UI: Lista de votaciones | Página `/votings` con votaciones activas y cerradas. |
| 6 | UI: Detalle de votación | Página `/votings/[id]` con opciones, botón de voto y resultados (ocultos hasta votar o una vez cerrada, según regla de negocio). |
| 7 | UI: Resultados | Gráfico de barras o donut con porcentajes. |
| 8 | Pruebas | Tests unitarios para lógica de voto único, tests de integración. |

### Dependencias
- Sprint 1 (UI/UX para gráficos)
- Sprint 6 (management roles)

### Criterios de Aceptación
- Los management pueden crear votaciones con opciones.
- Cada miembro autenticado puede votar una sola vez por votación.
- Los resultados se muestran después de votar o al cerrar la votación.
- Una vez cerrada, no se pueden añadir más votos.

---

## Sprint 16 — Gestión Documental (Supabase Storage)

**Rama:** `feature/sprint-16-document-management`

### Descripción
Gestionar documentos usando Supabase Storage con categorías, permisos por rol y control de versiones.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.document_categories` (id, name, description, parent_id opcional para jerarquía). Crear `umsuka.documents` (id, category_id, name, file_path, file_size, mime_type, uploaded_by, created_at, updated_at). |
| 2 | Configurar Storage | Crear bucket `documentos` en Supabase con políticas RLS. |
| 3 | Políticas de Storage | Solo management puede subir/eliminar. Todos los auth users pueden leer. |
| 4 | Capa `lib/documents/` | Schemas Zod, queries, mutations con integración a Supabase Storage (upload, download, delete). |
| 5 | Server actions | Acciones para subir, listar, descargar, eliminar documentos. |
| 6 | UI: Gestor de documentos | Página `/documents` con vista de carpetas/categorías, tabla de archivos, indicador de tamaño. |
| 7 | UI: Subida de documentos | Drag & drop o selector de archivos con barra de progreso. |
| 8 | Pruebas | Tests de integración con Storage. |

### Criterios de Aceptación
- Los documentos se organizan por categorías.
- Management puede subir, descargar y eliminar documentos.
- Todos los miembros autenticados pueden ver y descargar documentos.
- Los archivos se almacenan en Supabase Storage con control de acceso por RLS.
- El sistema muestra nombre, tamaño, tipo MIME y fecha de subida.

---

## Sprint 17 — Eventos: Mejora de Registro y Gestión

**Rama:** `feature/sprint-17-events-enhancement`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-17-events-enhancement.json`, `tasks/sprint-17b-attendance-only-meeting-carnival.json` y `docs/adr-sprint-17-events-enhancement.md`.

### Descripción
Mejorar la gestión de eventos: registro con campos adicionales, comentarios, capacidad máxima, y lista de espera. Además, se añade el flujo de **selección de grupo de trabajo en el primer inicio de sesión**: el usuario elige por primera vez el grupo al que pertenece (telas, barra, estandarte, limpieza); después, puede modificar su grupo desde su perfil y el super admin puede cambiarlo desde el panel de administración.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columnas a `umsuka.events`: `max_attendees`, `registration_deadline`, `location`, `image_url`. Crear `umsuka.event_comments` si se desea. |
| 2 | Capa `lib/events/` | Mejorar schemas existentes con los nuevos campos. |
| 3 | Lógica de lista de espera | Si el evento está lleno, los nuevos registros van a lista de espera (`umsuka.event_waitlist`). |
| 4 | UI: Página de evento | Rediseñar `/events/[id]` con toda la info: fecha, lugar, aforo, botón de registro, comentarios. |
| 5 | UI: Calendario de eventos | Vista de calendario mensual/semanal con todos los eventos. |
| 6 | Pruebas | Tests de integración (eventos) |
| 7 | Migración de BD — grupo de trabajo | La columna `workgroup` ya existe en `umsuka.profiles` (Sprint 2). Verificar que el estado inicial para usuarios nuevos sea `ninguno` o null para detectar "sin grupo asignado". |
| 8 | Onboarding: primer login | Detectar usuarios sin grupo asignado (workgroup = `ninguno` o null) y redirigirles a `/onboarding/workgroup` antes de que puedan acceder al resto de la app. |
| 9 | Middleware update | En `middleware.ts`, bloquear el acceso a las páginas de la app (dashboard, eventos, perfil, etc.) hasta que el usuario haya elegido su grupo de trabajo. |
| 10 | Server actions | `setMyWorkgroupAction` (el usuario elige por primera vez o modifica su grupo desde su perfil) y `setUserWorkgroupAction` (solo super admin, desde el panel de administración). |
| 11 | UI: Página de onboarding | Página `/onboarding/workgroup` con selector de grupo (telas, barra, estandarte, limpieza) y confirmación obligatoria antes de continuar. |
| 12 | UI: Perfil | En `/profile`, sección "Mi grupo de trabajo" con selector para modificar el grupo y nota de quién puede cambiarlo (el propio usuario y el super admin). |
| 13 | UI: Panel admin | En `/admin/users`, selector de grupo de trabajo editable por el super admin para cualquier usuario. |
| 14 | Pruebas | Tests unitarios de validación de roles. Tests de integración del flujo completo: primer login → onboarding → cambio desde perfil → cambio desde admin. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 5 (asistencia)
- Sprint 2 (Workgroup Roles — para la columna `workgroup` y los helpers `is_workgroup_lead`, `current_user_workgroup`)

### Criterios de Aceptación
- Los eventos tienen capacidad máxima y fecha límite de registro.
- Si el evento está lleno, los miembros pueden apuntarse a la lista de espera.
- Se muestra claramente el estado del evento y del registro del usuario.
- En el primer inicio de sesión, el usuario debe elegir su grupo de trabajo antes de poder usar la aplicación.
- Sin grupo asignado, no se puede acceder al resto de funcionalidades (el middleware redirige al onboarding).
- Cada usuario puede modificar su propio grupo de trabajo desde su perfil.
- El super admin puede cambiar el grupo de trabajo de cualquier usuario desde el panel de administración.

---

## Sprint 18 — Segmentación de Audiencia en Eventos

**Rama:** `feature/sprint-18-event-audience`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-18-event-audience.json` y `docs/adr-sprint-18-event-audience.md`.

### Descripción
Al crear un evento, el creador podrá indicar a qué tipo de usuarios se mostrará: por grupo de trabajo (telas, barra, estandarte, limpieza), por tipo de miembro (rol/componente) o a usuarios concretos seleccionables. Los eventos con audiencia restringida solo aparecerán para los destinatarios indicados.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — events | Añadir a `umsuka.events`: `audience_type` (enum: `all`, `workgroup`, `member_type`, `specific_users`), `audience_workgroup` (text nullable), `audience_member_type` (text nullable). |
| 2 | Migración de BD — event_audience_users | Crear `umsuka.event_audience_users` (event_id FK, user_id FK, PK compuesta) para la lista de usuarios concretos cuando `audience_type = 'specific_users'`. |
| 3 | RLS — visibilidad por audiencia | Añadir política SELECT en `umsuka.events`: visible si `audience_type = 'all'` O (`audience_type = 'workgroup'` y `audience_workgroup = current_user_workgroup()`) O (`audience_type = 'member_type'` y `audience_member_type = current_user_component()`) O (`audience_type = 'specific_users'` y el usuario está en `event_audience_users`). |
| 4 | Actualizar tipos | Regenerar `src/types/database.types.ts`. |
| 5 | Capa `lib/events/audience.ts` | Schemas Zod (audienceSchema), queries (getVisibleEvents, getEventAudience), mutations (createEventWithAudience, updateEventAudience). |
| 6 | Server actions | `createEventWithAudienceAction`, `updateEventAudienceAction`, `getVisibleEventsAction`. |
| 7 | UI: Formulario de evento | En el formulario de creación/edición de evento, sección "¿A quién se muestra?" con selector de tipo (todos / por grupo / por tipo de miembro / usuarios concretos) y los selectores correspondientes (multi-select de usuarios con búsqueda). |
| 8 | UI: Feed de eventos filtrado | La página de eventos solo muestra eventos visibles para el usuario según la audiencia configurada. |
| 9 | UI: Badge de audiencia | En el detalle del evento, mostrar a qué audiencia está dirigido (visible para management). |
| 10 | Pruebas | Tests unitarios de los schemas de audiencia. Tests de integración de las políticas de visibilidad. |

### Dependencias
- Sprint 2 (Workgroup Roles — para `current_user_workgroup()`)
- Sprint 12 (Visibilidad por grupo de turnos — patrón de RLS similar)
- Sprint 17 (Eventos — para el formulario de eventos)

### Criterios de Aceptación
- Al crear un evento se puede elegir: todos, un grupo de trabajo, un tipo de miembro o usuarios concretos.
- Los eventos restringidos solo aparecen para sus destinatarios.
- Un usuario no puede ver eventos dirigidos a otros grupos/tipos/usuarios.
- El creador y management pueden ver la audiencia configurada de cada evento.
- La configuración de audiencia puede modificarse después de crear el evento.

---

## Sprint 19 — Perfiles y Componentes

**Rama:** `feature/sprint-19-profiles-components`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-19-profiles-components.json` y `docs/adr-sprint-19-profiles-components.md`.

### Descripción
Mejorar la gestión de perfiles de usuario: foto, biografía, componentes (telas, barra, etc.), habilidades, y historial de participación.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columnas a `umsuka.profiles`: `avatar_url`, `bio`, `phone`, `skills` (text[]), `joined_at`. |
| 2 | Capa `lib/profiles/` | Mejorar schemas y queries. |
| 3 | UI: Página de perfil | Rediseñar `/profile` con foto, datos personales, componente, skills, historial. |
| 4 | UI: Editar perfil | Formulario completo de edición. |
| 5 | Pruebas | Tests unitarios. |

### Dependencias
- Sprint 1 (UI/UX)

### Criterios de Aceptación
- Cada miembro tiene un perfil con foto, biografía y habilidades.
- Los miembros pueden editar su propio perfil.
- La página de perfil muestra el historial de eventos, turnos y asistencia.

---

## Sprint 20 — Notificaciones

**Rama:** `feature/sprint-20-notifications`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-20-notifications.json` y `docs/adr-sprint-20-notifications.md`.

### Descripción
Sistema de notificaciones internas (en-app) y en tiempo real sobre eventos, noticias, votaciones y cambios relevantes.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.notifications` (id, user_id, title, message, type, is_read, link, created_at). Crear `umsuka.notification_preferences` (user_id, types[]). |
| 2 | Capa `lib/notifications/` | Queries (getMyNotifications, getUnreadCount), mutations (markAsRead, markAllAsRead, createNotification). |
| 3 | Server actions | Acciones para marcar como leídas. |
| 4 | UI: Campana de notificaciones | En el header, icono de campana con contador de no leídas, dropdown con las últimas notificaciones. |
| 5 | UI: Página de notificaciones | `/notifications` con historial completo. |
| 6 | Notificaciones en tiempo real | Usar Supabase Realtime para notificaciones push en vivo. |
| 7 | Integrar con otros módulos | Al crear evento → notificar; al crear noticia → notificar; al asignar turno → notificar; etc. |
| 8 | Pruebas | Tests de integración con Realtime. |

### Dependencias
- Prácticamente todos los sprints anteriores (las notificaciones se integran con eventos, noticias, turnos, etc.)

### Criterios de Aceptación
- Las notificaciones se crean automáticamente al asignar turnos, crear eventos/noticias/votaciones.
- El usuario ve el contador de no leídas en el header.
- Las notificaciones se marcan como leídas al hacer clic.
- Soporte de notificaciones en tiempo real vía Supabase Realtime.

---

## Sprint 21 — Administración: Panel de Control

**Rama:** `feature/sprint-21-admin-panel`

### Estado
✅ **Ejecutado.** Ver `tasks/sprint-21-admin-panel.json` y `docs/adr-sprint-21-admin-panel.md`.

### Descripción
Panel de administración completo para gestión de usuarios, configuración global, permisos y auditoría.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.settings` (key, value, updated_by, updated_at). Crear `umsuka.audit_logs` (id, user_id, action, entity_type, entity_id, details, created_at). |
| 2 | Capa `lib/admin/` | Queries y mutations para gestión de usuarios, settings, logs. |
| 3 | Server actions | Acciones para cambiar roles, actualizar settings. |
| 4 | UI: Panel de administración | Refactorizar `/admin/users` con tabla completa: nombre, email, rol, status, componente, fecha de registro. Acciones: editar rol, aprobar/suspender, ver logs. |
| 5 | UI: Configuración global | Página `/admin/settings` con settings de la app (nombre, Instagram URL, etc.). |
| 6 | UI: Auditoría | Página `/admin/audit` con logs de actividad filtrables por usuario, acción y fecha. |
| 7 | Sistema de permisos granular | Migrar de roles fijos a permisos por rol (tabla `umsuka.role_permissions`). |
| 8 | Pruebas | Tests de integración para cada acción administrativa. |

### Dependencias
- Sprint 6 (aprobación de usuarios)
- Sprint 19 (perfiles completos)

### Criterios de Aceptación
- Los super admin pueden ver y gestionar todos los usuarios (cambiar roles, activar/suspender).
- La configuración global es modificable desde el panel.
- Cada acción administrativa queda registrada en el log de auditoría.
- Los logs son consultables con filtros.

---

## Sprint 22 — Eliminación Lógica de Cuentas (Solo Super Admin)

**Rama:** `feature/sprint-22-account-soft-deletion`

### Estado
✅ **Ejecutado** (PR #24 mergeado el 2026-08-20, rama `feature/sprint-22-account-deletion`). Ver `tasks/sprint-22-account-deletion.json` y `docs/adr-sprint-22-account-deletion.md`. La especificación de soft-delete/restauración descrita abajo queda como evolución pendiente de re-evaluación.

### Descripción
Permitir que solo el super admin "elimine" cuentas de forma **lógica (soft delete)**, no física. **Ningún dato se borra de la base de datos**: el perfil y todas sus relaciones (asistencia, turnos, ausencias, eventos, votaciones, preguntas, notificaciones, documentos, etc.) se conservan intactos para mantener el histórico y la integridad referencial. La cuenta queda marcada como eliminada, el usuario pierde el acceso a la aplicación y sus datos dejan de aparecer en los listados; el super admin puede restaurarla en cualquier momento. Requiere confirmación explícita y registro de auditoría.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — soft delete | Añadir a `umsuka.profiles`: columna `deleted_at` (timestamptz, null = cuenta activa) y `deleted_by` (uuid, FK a profiles). **No se elimina ninguna fila ni se alteran las FKs existentes.** |
| 2 | Bloqueo de acceso (auth) | Impedir el login del usuario eliminado SIN borrarlo de `auth.users`: usar `supabase.auth.admin.updateUserById(userId, { ban_duration: '876000h' })` (o soft-delete de auth) para banear la cuenta. Cerrar sesiones activas. |
| 3 | RLS — exclusión de eliminados | Actualizar las políticas RLS y las queries para excluir perfiles con `deleted_at` no nulo de todos los listados (miembros, búsquedas, estadísticas, etc.). Las tablas relacionadas (attendance, shift_assignments, etc.) NO pierden las referencias. |
| 4 | Servicio `lib/auth/delete-account.ts` | Implementar `softDeleteAccount(userId)`: (1) verificar rol super_admin, (2) marcar `deleted_at` + `deleted_by` en profiles, (3) banear el usuario en auth, (4) invalidar sesiones, (5) registrar en `audit_logs`. **Sin borrados en cascada ni DELETE de ningún tipo.** |
| 5 | Servicio `lib/auth/restore-account.ts` | Implementar `restoreAccount(userId)`: (1) verificar rol super_admin, (2) limpiar `deleted_at` y `deleted_by`, (3) desbanear el usuario en auth (ban_duration 'none'), (4) registrar en `audit_logs`. |
| 6 | Server actions | `softDeleteAccountAction`, `restoreAccountAction` — solo super_admin, con confirmación de doble paso. |
| 7 | UI: Confirmación | En `/admin/users`, botón "Eliminar cuenta" que abre diálogo con advertencia explicando que es una **eliminación lógica**: "El usuario perderá el acceso, pero sus datos e historial se conservan", pidiendo teclear el nombre del usuario o "ELIMINAR" para confirmar. |
| 8 | UI: Vista de eliminados y restauración | En `/admin/users`, filtro/pestaña "Eliminadas" (con `deleted_at`) que muestra las cuentas marcadas como eliminadas y permite restaurarlas con el botón "Restaurar cuenta" (con confirmación). |
| 9 | UI: Feedback | Mensaje de éxito/error tras eliminar/restaurar, y actualización de la lista de usuarios. |
| 10 | Referencias históricas | Verificar que en los listados que muestren datos históricos (p. ej. asistencia, turnos, votos) el nombre del miembro eliminado se muestre con fallback ("Miembro eliminado") manteniendo el registro intacto. |
| 11 | Pruebas | Tests unitarios de los servicios. Tests de integración: solo super_admin puede eliminar/restaurar, **ninguna fila se borra físicamente**, las relaciones se conservan, el usuario eliminado no puede iniciar sesión, la restauración devuelve el acceso, no se puede eliminar el propio super admin. |

### Dependencias
- Sprint 21 (Admin Panel — para el panel de usuarios y audit_logs)
- Sprint 6 (Registration Approval — para el estado de cuentas)

### Criterios de Aceptación
- Solo el super admin puede eliminar (lógicamente) y restaurar cuentas.
- La eliminación es **100% lógica**: no se elimina ninguna fila de la base de datos y todas las relaciones existentes (asistencia, turnos, ausencias, votaciones, preguntas, notificaciones, etc.) se conservan intactas.
- El usuario eliminado no puede iniciar sesión ni acceder a la aplicación.
- Las cuentas eliminadas quedan excluidas de los listados, búsquedas y estadísticas (vía RLS y queries).
- El super admin puede restaurar una cuenta eliminada en cualquier momento, devolviéndole el acceso.
- Se requiere confirmación explícita (doble paso) antes de eliminar.
- La eliminación y la restauración quedan registradas en el log de auditoría.
- Un super admin no puede eliminarse a sí mismo (protección).

---

## Sprint 23 — PWA: Progressive Web App

**Rama:** `feature/sprint-23-pwa`

### Descripción
Convertir la aplicación en una Progressive Web App instalable con soporte offline mediante Service Workers.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Configurar next-pwa | `next-pwa` ya está en dependencias. Configurar en `next.config.ts` con opciones de Service Worker. |
| 2 | Manifest.json | Crear `public/manifest.json` con nombre, iconos, colores, display standalone. |
| 3 | Service Worker | Configurar estrategias de cache (NetworkFirst para API, StaleWhileRevalidate para assets, CacheFirst para estáticos). |
| 4 | Iconos PWA | Generar iconos en múltiples tamaños (192x192, 512x512) y colocarlos en `/public/icons/`. |
| 5 | Estrategia offline | Página offline por defecto (`/offline`) y sincronización al recuperar conexión. |
| 6 | Hook de registro | Componente `PwaRegister` que muestre banner de instalación en navegadores compatibles. |
| 7 | Menú inferior deslizable (mobile) | Asegurar que el menú inferior de la aplicación en móviles **se pueda deslizar horizontalmente (swipe)** para poder ver TODAS las secciones, incluso cuando el número de ítems exceda el ancho de la pantalla. Actualmente no se puede acceder a algunas secciones en el bottom nav. |
| 8 | Pruebas | Verificar instalación en Chrome, Firefox, Safari iOS, Edge. Probar offline mode. Probar el menú inferior deslizable en móvil (todas las secciones accesibles). |

### Criterios de Aceptación
- La aplicación es instalable en navegadores compatibles (Chrome, Edge, Safari iOS).
- Los assets estáticos se cachean y funcionan offline.
- La aplicación muestra una página offline personalizada.
- El manifest.json tiene todos los campos requeridos.
- Los iconos se muestran correctamente después de la instalación.
- El menú inferior en móvil es deslizable horizontalmente y muestra todas las secciones (ninguna queda inaccesible).

---

## Sprint 24 — Gestión de Instrumentos

**Rama:** `feature/sprint-24-instrument-management`

### Descripción
Gestionar el inventario de instrumentos de la comparsa: alta, baja y edición de instrumentos, asignación de una persona responsable por instrumento y registro histórico de responsables. Solo la directiva y el super_admin pueden gestionar el inventario y las asignaciones.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.instruments` (id, name, category, description, is_active, created_at, updated_at) e `umsuka.instrument_assignments` (id, instrument_id, user_id, assigned_at, unassigned_at). |
| 2 | RLS | Directiva (`is_directiva`) y super_admin pueden crear/editar/desactivar instrumentos. Leer: todos los auth users. |
| 3 | Capa de negocio `lib/instruments/` | Schemas Zod (createInstrumentSchema, assignSchema), queries (getInstruments, getAssignments), mutations (createInstrument, updateInstrument, toggleActive, assign, unassign). |
| 4 | Server actions | Wrappers thin con validación de rol (directiva o super_admin) y revalidación de path. |
| 5 | UI de inventario | Página `/instruments` con listado de instrumentos, creación/edición, activar/desactivar y asignación/desasignación de responsable. |
| 6 | Historial | Mostrar historial de responsables de cada instrumento. |
| 7 | Pruebas | Tests unitarios para schemas y tests de integración para acciones y RLS. |

### Dependencias
- Sprint 2 (Roles — para validar directiva/super_admin)
- Sprint 19 (Perfiles — para el responsable asignado)

### Criterios de Aceptación
- La directiva y el super_admin pueden gestionar instrumentos (alta, edición, baja lógica).
- Cada instrumento puede tener una persona responsable asignada (una a la vez).
- El historial de responsables de cada instrumento queda registrado.
- Los instrumentos inactivos no aparecen en los listados de asignación.

---

## Sprint 25 — Ordenación de Listados

**Rama:** `feature/sprint-25-list-ordering`

### Descripción
Permitir ordenar los principales listados de la aplicación (miembros, instrumentos, eventos) por distintos criterios, de forma persistente por usuario.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Tabla `umsuka.user_preferences` (user_id PK, list_ordering jsonb) o reutilizar preferencias existentes si el sprint 19 ya las define. |
| 2 | Capa de negocio `lib/ordering/` | Utilidades para aplicar ordenaciones: por nombre, por fecha de alta, por trabajo, por instrumento, por asistencia, etc. Almacenar la preferencia por usuario. |
| 3 | UI de ordenación | Menú desplegable "Ordenar por" en los listados de miembros, instrumentos y eventos. |
| 4 | Persistencia | Guardar la preferencia del usuario en `user_preferences` y reaplicarla al volver. |
| 5 | Pruebas | Tests unitarios de las funciones de ordenación y de persistencia. |

### Dependencias
- Sprint 14 (Listado de Miembros)
- Sprint 19 (Perfiles — preferencias de usuario si aplica)

### Criterios de Aceptación
- Los listados de miembros, instrumentos y eventos se pueden ordenar por al menos 3 criterios distintos.
- La preferencia de ordenación se guarda por usuario y se mantiene entre visitas.
- La ordenación funciona correctamente con paginación.

---

## Sprint 26 — Buscador de Personas en Turnos

**Rama:** `feature/sprint-26-shift-member-search`

### Descripción
Añadir un buscador de personas en la gestión de turnos para permitir al responsable de grupo (o super admin) buscar y marcar rápidamente la asistencia de un miembro concreto en un turno, sin tener que recorrer toda la lista.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Capa de negocio `lib/shifts/search.ts` | Función `searchShiftMembers(shiftId, query)` que busque por nombre, apellidos o workgroup con indexación en BD. |
| 2 | Server action | `searchShiftMembersAction` con paginación. |
| 3 | UI | Barra de búsqueda en el panel de gestión de turno con resultados en vivo y botón de marcar/desmarcar asistencia directo desde los resultados. |
| 4 | Accesibilidad | Resultados navegables por teclado y compatibles con lectores de pantalla. |
| 5 | Pruebas | Tests de la búsqueda e integración con el panel de turnos. |

### Dependencias
- Sprint 8 (Shifts)
- Sprint 12 (Asociación de Personas a Turnos)

### Criterios de Aceptación
- El responsable de grupo puede buscar a cualquier miembro asignado a un turno por nombre.
- Los resultados aparecen en tiempo real y permiten marcar la asistencia sin salir de la búsqueda.
- Combinado con la búsqueda por workgroup (telas, barra, estandarte, limpieza).

---

## Sprint 27 — Asistencia a Ensayos

**Rama:** `feature/sprint-27-rehearsal-attendance`

### Descripción
Registrar la asistencia de los miembros a los ensayos de la comparsa. Cada ensayo es un evento de tipo `rehearsal` con sesiones de mañana y tarde; los responsables pueden marcar quién asistió y las estadísticas alimentan el perfil y el porcentaje de participación.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — event_type rehearsal | Añadir `'rehearsal'` como tipo de evento válido. Campos opcionales `session` (mañana/tarde) en `umsuka.events`. |
| 2 | Migración de BD — rehearsal_attendance | Crear `umsuka.rehearsal_attendance` (id, event_id, user_id, session, attended, marked_by, timestamps) con RLS. |
| 3 | Helper functions | `umsuka.is_rehearsal_lead()` si aplica, o reutilizar directiva/super_admin para marcar asistencia. |
| 4 | Capa de negocio `lib/rehearsals/` | Queries y mutations para registrar/editar asistencia a sesiones de mañana/tarde. |
| 5 | UI de registro | Panel en la página de detalle del ensayo para marcar asistencia por sesión (mañana/tarde). |
| 6 | Integración con estadísticas | Alimentar el % de participación en ensayos del perfil de cada miembro (usado también por Sprint 28). |
| 7 | Pruebas | Tests de la capa de negocio y de las políticas RLS. |

### Dependencias
- Sprint 5 (Asistencia y Ausencias — reutiliza el flujo)
- Sprint 17 (Eventos — el ensayo es un tipo de evento)

### Criterios de Aceptación
- Se pueden crear eventos de tipo "ensayo" con sesión de mañana y/o tarde.
- Los responsables pueden marcar asistencia por sesión.
- La asistencia a ensayos se refleja en las estadísticas del perfil.

---

## Sprint 28 — Estadísticas Personales

**Rama:** `feature/sprint-28-personal-stats`

### Descripción
Panel de estadísticas personales para cada miembro: porcentaje de asistencia a turnos, ensayos y eventos, comparación con el grupo de trabajo, racha actual y tendencia en el tiempo.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Capa de negocio `lib/stats/` | Funciones `getPersonalStats(userId)` (asistencia a turnos, ensayos, eventos; racha; tendencia), `getWorkgroupComparison(userId)` y `getEventStats(eventId)`. |
| 2 | Server actions | `getPersonalStatsAction` con caché y revalidación. |
| 3 | UI de estadísticas personales | Sección en el perfil del miembro con tarjetas: % asistencia turnos, % ensayos, % eventos, racha actual, mini-gráficos de tendencia (últimos 6 meses). |
| 4 | Comparativa | Gráfico comparando la asistencia del miembro con la media de su grupo de trabajo. |
| 5 | Event stats | Vista de estadísticas por evento (asistencia total, por grupo) para responsables. |
| 6 | Pruebas | Tests de las funciones de cálculo de estadísticas con datos de ejemplo. |

### Dependencias
- Sprint 5 (Asistencia), Sprint 12 (Turnos), Sprint 27 (Ensayos), Sprint 17 (Eventos)

### Criterios de Aceptación
- Cada miembro ve sus estadísticas personales en su perfil (propias y de los responsables de su grupo).
- Las estadísticas se calculan en tiempo real sobre los datos de asistencia existentes.
- Se muestra racha actual y tendencia en el tiempo.

---

## Sprint 29 — Gestión de Dinero de la Comparsa

**Rama:** `feature/sprint-29-money-management`

### Descripción
Permitir llevar el control del dinero de la comparsa desde la aplicación: registrar ingresos (p. ej. turnos de barra) y gastos (p. ej. compras de barra, compras de material del traje, compras de material para baile, otros). Incluye una vista de resumen con totales y estadísticas. **Solo la directiva y el super_admin pueden ver y gestionar esta funcionalidad.**

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Crear `umsuka.transactions` (id, type ENUM `income`/`expense`, category ENUM `bar_shift`/`bar_purchases`/`costume_materials`/`dance_materials`/`other`, amount numeric(10,2), description, transaction_date, created_by, created_at) con índices. |
| 2 | RLS | Solo directiva (`is_directiva`) y super_admin pueden insertar/leer/actualizar/eliminar transacciones. El resto de usuarios no ve la sección. |
| 3 | Helper `umsuka.is_directiva()` | Añadir helper en SQL similar a `is_super_admin()` (o una tabla de roles de directiva si aún no existe). |
| 4 | Capa de negocio `lib/finances/` | Schemas Zod (createTransactionSchema, updateTransactionSchema), queries (getTransactions con filtros por tipo/categoría/fecha, getSummary), mutations (create, update, delete). |
| 5 | Server actions | Wrappers thin con validación de rol (directiva o super_admin) y revalidación de path. |
| 6 | UI de gestión | Página `/finances` solo visible para directiva y super_admin: alta de ingresos/gastos con formulario (tipo, categoría, importe, descripción, fecha), listado con filtros y edición/eliminación. |
| 7 | Vista resumen | Tarjetas con totales: ingresos, gastos, saldo, y desglose por categoría (turnos de barra, compras de barra, material del traje, material para baile). |
| 8 | Estadísticas | Gráficos mensuales de ingresos vs gastos y distribución por categoría. |
| 9 | Pruebas | Tests unitarios de schemas y de cálculo de resumen. Tests de integración: solo directiva/super_admin acceden. |

### Dependencias
- Sprint 2/21 (Roles — para validar directiva y super_admin)
- Sprint 3 (Barra — los ingresos de turno de barra se registran aquí)

### Criterios de Aceptación
- La directiva y el super_admin pueden registrar ingresos y gastos con categorías predefinidas (turno de barra, compras de barra, material del traje, material para baile, otros).
- La página `/finances` y todos sus datos son **invisibles** para el resto de roles (no solo ocultos en el menú).
- La vista de resumen muestra totales de ingresos, gastos, saldo y desglose por categoría.
- Se pueden consultar estadísticas mensuales de ingresos vs gastos.
- Las transacciones se pueden filtrar por tipo, categoría y rango de fechas.

---

## Sprint 30 — Representante Legal para Menores de Edad

**Rama:** `feature/sprint-30-legal-guardian`

### Descripción
Permitir que un componente menor de edad tenga un representante legal asociado. El representante legal puede ser **otro componente de la comparsa** o una **persona nueva dada de alta como representante** (con sus datos de contacto). El representante puede ejercer acciones legales/responsabilidades en nombre del menor según lo requiera la administración.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir a `umsuka.profiles`: `is_minor` (boolean) y `legal_guardian_id` (uuid, nullable, FK a `umsuka.legal_guardians`). Crear `umsuka.legal_guardians` (id, full_name, document_id, email, phone, relationship, is_member (bool), member_user_id (nullable, si es otro componente), created_at). |
| 2 | RLS | El representante registrado puede consultar los datos del menor que representa (con consentimiento). Super_admin y directiva gestionan los vínculos. |
| 3 | Capa de negocio `lib/guardians/` | Schemas Zod (createGuardianSchema, assignGuardianSchema), queries (getGuardians, getMinorProfiles), mutations (createGuardian, assignGuardian, updateGuardian). |
| 4 | Server actions | Wrappers thin con validación de rol (super_admin/directiva) y revalidación. |
| 5 | UI de registro | Al dar de alta a un menor, opción de marcar `is_minor` y asignar representante legal: o bien seleccionar un componente existente, o bien crear un **nuevo componente** que actuará como representante. |
| 6 | UI de gestión | En `/admin` (o `/directiva`), listado de menores con su representante actual, opción de cambiar de representante y de editar los datos del representante. |
| 7 | Permisos del representante | El representante (si tiene cuenta de usuario, p. ej. si es otro componente) ve la información del menor y puede realizar acciones permitidas (p. ej. confirmar asistencias, ver notificaciones del menor). |
| 8 | Pruebas | Tests de la capa de negocio y de RLS. Verificar que un menor sin representante queda pendiente de asignación. |

### Dependencias
- Sprint 6 (Registration Approval — flujo de alta de nuevos componentes)
- Sprint 19 (Perfiles — campos y edición de perfil)
- Sprint 14 (Listado de Miembros — para seleccionar representante entre componentes)

### Criterios de Aceptación
- Un perfil puede marcarse como menor de edad (`is_minor`).
- Todo menor de edad debe tener un representante legal asignado (obligatorio al registrarse o asignado posteriormente por super_admin/directiva).
- El representante legal puede ser otro componente de la comparsa o una persona nueva dada de alta en el sistema.
- El representante con cuenta de usuario puede ver la información del menor que representa y ejercer las acciones permitidas.
- El super_admin y la directiva pueden administrar las asignaciones y los datos de los representantes.

---

## Sprint 31 — Control de Pagos y Reparto de Material

**Rama:** `feature/sprint-31-payment-tracking`

### Descripción
Permitir que la directiva y el super_admin registren qué miembros han pagado un mes en específico o el año completo (cuotas de la comparsa). Cuando se crea un evento de tipo **"reparto de material"**, el sistema genera automáticamente una lista con todos los miembros que han pagado hasta el mes del evento, para que solo ellos puedan recibir el material. Esto evita que personas sin cuas al día reciban material de la comparsa.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — pagos | Crear `umsuka.member_payments` (id, user_id FK, payment_type ENUM `monthly`/`yearly`, period_month INT nullable — mes del pago mensual (1-12), period_year INT — año del pago, amount numeric(10,2), paid_at date, registered_by FK, notes text nullable, created_at). Crear índices únicos parciales para evitar pagos duplicados por usuario/mes/año. |
| 2 | Migración de BD — event_type material_distribution | Añadir `'material_distribution'` como tipo de evento válido. |
| 3 | RLS | Super_admin y directiva (`is_directiva`) pueden registrar/editar/eliminar pagos. Los miembros autenticados pueden consultar su propio historial de pagos. |
| 4 | Capa de negocio `lib/payments/` | Schemas Zod (registerPaymentSchema, bulkRegisterSchema), queries (getPaymentsByUser, getPaidMembersUpToMonth, getPaymentStatus), mutations (registerPayment, updatePayment, deletePayment, bulkRegisterMonthly). Función clave: `getPaidMembersForEvent(eventDate)` — devuelve los IDs de miembros que tienen un pago cubriende el mes del evento (pago mensual de ese mes o pago anual que cubra ese año). |
| 5 | Server actions | `registerPaymentAction`, `bulkRegisterMonthlyAction` (registrar pagos de un mes para varios miembros a la vez), `getPaidMembersForEventAction`. |
| 6 | UI de registro de pagos | Página `/payments` (solo directiva/super_admin): listado de miembros con su estado de pago (al día / pendiente), formulario para registrar pago mensual o anual, opción de registro masivo por mes. |
| 7 | Vista de estado de pago | En el perfil de cada miembro, tarjeta "Estado de cuotas" visible para el propio miembro: meses pagados, próximo vencimiento. |
| 8 | Integración con eventos de reparto | Al crear un evento de tipo `material_distribution`, el sistema muestra la lista de miembros elegibles (los que han pagado hasta el mes del evento). Esta lista se genera automáticamente y se puede exportar/imprimir el día del evento. |
| 9 | Fallback —缺 de pago | Si un miembro no tiene pago registrado para el mes del evento, aparece en una lista separada "Pendientes de pago" y no puede recibir material. |
| 10 | Pruebas | Tests unitarios de `getPaidMembersForEvent` con escenarios: pago mensual vigente, pago anual vigente, sin pago, pago vencido. Tests de bulk register. Tests de RLS: solo directiva/super_admin registran, miembros solo leen su propio historial. |

### Dependencias
- Sprint 2/21 (Roles — directiva y super_admin)
- Sprint 17 (Eventos — para el tipo `material_distribution`)
- Sprint 19 (Perfiles — para la vista de estado de pago en el perfil)

### Criterios de Aceptación
- La directiva y el super_admin pueden registrar pagos mensuales o anuales para cualquier miembro.
- Se puede hacer registro masivo de pagos de un mes completo para múltiples miembros a la vez.
- Los miembros ven su propio historial de pagos en su perfil.
- Al crear un evento de tipo "reparto de material", el sistema genera automáticamente la lista de miembros que han pagado hasta el mes del evento.
- La lista de elegibles se puede exportar/imprimir el día del evento.
- Un miembro sin pago al día queda en la lista de "pendientes" y no puede recibir material.
- No se permiten pagos duplicados para el mismo mes/año del mismo miembro.

---

## Sprint 32 — Inscripción Automática a Ensayos

**Rama:** `feature/sprint-32-rehearsal-auto-enroll`

### Descripción
Cuando se crea un ensayo (evento de tipo `rehearsal`), el sistema **inscribe automáticamente** a todos los miembros del grupo de trabajo correspondiente (música o baile) en ese ensayo. Los miembros **no pueden inscribirse por sí mismos**; solo el sistema al crear el ensayo o el super_admin/directiva pueden gestionar las inscripciones. Esto permite que los responsables marquen la asistencia de los ya inscritos, sin tener que añadirlos uno a uno.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — rehearsal category | Añadir columna `rehearsal_category` ENUM (`music`/`dance`) a `umsuka.events` (nullable, solo para eventos tipo `rehearsal`). |
| 2 | Extender `umsuka.rehearsal_attendance` | Añadir campo `enrolled` (boolean, default false) y `enrolled_at` (timestamptz). Los registros pre-inscritos se crean automáticamente con `enrolled = true`. |
| 3 | Server action de auto-inscripción | Al crear un evento tipo `rehearsal` con `rehearsal_category` definida, ejecutar una server action que busque todos los miembros cuyo `workgroup` coincida (`music` → miembros de música, `dance` → miembros de baile) y cree registros en `rehearsal_attendance` con `enrolled = true` y `attended = false`. |
| 4 | Bloqueo de auto-inscripción | Las políticas RLS de `rehearsal_attendance` impiden que un miembro se auto-inserte. Solo el sistema (server actions con service_role) y el super_admin/directiva pueden crear registros. |
| 5 | Capa de negocio `lib/rehearsals/auto-enroll.ts` | Función `autoEnrollRehearsal(eventId, category)` que: (1) valida que el evento sea tipo `rehearsal`, (2) busca miembros del workgroup correspondiente, (3) inserta en `rehearsal_attendance` ignorando duplicados (upsert). |
| 6 | UI de ensayo | En la página de detalle del ensayo, mostrar la lista de inscritos con su estado (asistió / no asistió / pendiente). El responsable solo puede marcar asistencia, no añadir/eliminar inscritos. |
| 7 | notificación | Cuando se crea un ensayo, notificar a los miembros inscritos automáticamente (integrar con Sprint 20 — Notificaciones). |
| 8 | Pruebas | Tests de `autoEnrollRehearsal`: verifica que se inscriben todos los miembros del workgroup correcto, que no se duplican si ya existen, que un miembro de otro workgroup no se inscribe. Tests de RLS: miembro no puede auto-insertarse. |

### Dependencias
- Sprint 2 (Workgroup Roles — workgroup `music`/`dance` en profiles)
- Sprint 5 (Asistencia — extiende `rehearsal_attendance`)
- Sprint 17 (Eventos — tipo `rehearsal`)
- Sprint 27 (Asistencia a Ensayos — esta funcionalidad se integra con el registro de asistencia de ese sprint)

### Criterios de Aceptación
- Al crear un ensayo de música, se inscriben automáticamente **todos** los miembros con workgroup = `music`.
- Al crear un ensayo de baile, se inscriben automáticamente **todos** los miembros con workgroup = `dance`.
- Los miembros **no pueden** inscribirse por sí mismos en un ensayo.
- Los miembros de un workgroup incorrecto no se inscriben en un ensayo de otro workgroup.
- Si un miembro ya estaba inscrito (caso raro), no se duplica el registro.
- Los responsables pueden marcar asistencia sobre los ya inscritos.
- Se envía notificación automática a los miembros inscritos al crear el ensayo.

---

## Sprint 33 — Posicionamiento de Bailarinas e Instrumentos de Músicos

**Rama:** `feature/sprint-33-dance-formation-instruments`

### Descripción
Permitir ordenar a las **bailarinas por posición** en una vista gráfica tipo **asientos de avión**, donde cada fila tiene **6 posiciones** y se pueden asignar/arrastrar personas del grupo de baile a cada asiento. Además, para cada **músico** se podrá asignar un **instrumento del inventario** (Sprint 24) que tocará en el desfile/ensayo. La directiva y el super_admin gestionan la formación; todos los miembros pueden consultarla.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — formación | Crear `umsuka.dance_formations` (id, name, event_id FK nullable — formación ligada a un evento/desfile o formación base reutilizable, created_by, created_at) y `umsuka.dance_positions` (id, formation_id FK, row_number INT, seat_number INT 1-6, member_id FK nullable — bailarina asignada, created_at). Índice único (formation_id, row_number, seat_number). |
| 2 | Migración de BD — instrumento por músico | Crear `umsuka.musician_instruments` (id, user_id FK, instrument_id FK → `umsuka.instruments`, formation_id FK nullable, assigned_by, assigned_at) o reutilizar/extender `umsuka.instrument_assignments` del Sprint 24 añadiendo `formation_id`. Un músico solo puede tener un instrumento activo a la vez por formación. |
| 3 | RLS | Directiva y super_admin pueden crear/editar formaciones y asignar bailarinas/músicos. Todos los miembros autenticados pueden consultar la formación. |
| 4 | Capa de negocio `lib/formation/` | Schemas Zod (createFormationSchema, assignDancerSchema, assignInstrumentSchema), queries (getFormation, getFormations, getAvailableDancers, getAvailableInstruments), mutations (createFormation, assignDancerToSeat, removeDancerFromSeat, moveDancer, assignInstrumentToMusician, unassignInstrument). Validar que solo miembros con workgroup = `baile`/`dance` se asignen a asientos y solo `música`/`music` a instrumentos. |
| 5 | Server actions | `createFormationAction`, `assignDancerAction`, `moveDancerAction`, `assignInstrumentAction` — con validación de rol y revalidación. |
| 6 | UI — Plano de bailarinas (tipo avión) | Componente `DanceFormationGrid` que renderiza filas de 6 asientos (3-3 con pasillo visual en medio, como un avión). Cada asiento muestra avatar/nombre de la bailarina asignada o estado vacío. Drag & drop para mover bailarinas entre asientos, panel lateral con listado de bailarinas sin asignar para arrastrar al plano. Botón guardar y vista de solo lectura para miembros. |
| 7 | UI — Asignación de instrumentos | Panel `MusicianInstrumentList` con listado de músicos y selector de instrumento del inventario (solo instrumentos disponibles). Indicador de instrumento ya asignado a otro músico. Historial de asignaciones por músico. |
| 8 | Integración con eventos | Si la formación está ligada a un evento (desfile), mostrar el plano y los instrumentos en la página de detalle del evento. Permitir duplicar una formación base a un nuevo evento. |
| 9 | Exportar / Imprimir | Botón para exportar el plano a PDF/imagen para llevar al ensayo/desfile. |
| 10 | Pruebas | Tests unitarios de asignación (no duplicar asiento, no asignar bailarina ya colocada en otro asiento, validar workgroup). Tests de integración RLS: solo directiva/super_admin asignan. Tests visuales del grid con 6 por fila. |

### Dependencias
- Sprint 2 (Workgroup Roles — workgroup `baile`/`dance` y `música`/`music`)
- Sprint 17 (Eventos — formación opcionalmente ligada a un evento)
- Sprint 24 (Instrument Management — inventario de instrumentos)
- Sprint 19 (Perfiles — listado de miembros por workgroup)

### Criterios de Aceptación
- Las filas del plano de bailarinas son siempre de **6 personas** y se visualizan gráficamente como asientos de avión (rejilla con pasillo central).
- Se puede asignar cualquier bailarina del grupo de baile a un asiento vacío mediante drag & drop o selección.
- Se puede mover una bailarina de un asiento a otro y quitarla de su posición.
- No se puede asignar la misma bailarina a dos asientos simultáneamente.
- Solo la directiva y el super_admin pueden editar la formación; el resto solo la consulta.
- Cada músico puede tener asignado un instrumento del inventario y se valida que el instrumento esté disponible.
- La formación se puede ligar a un evento y visualizarse en su detalle.
- El plano se puede exportar/imprimir.

---

## Sprint 34 — Actas de Reuniones y Resumen en Dashboard/Perfil

**Rama:** `feature/sprint-34-meeting-minutes-summary`

### Descripción
Dos bloques en un mismo sprint: **(A) Actas de reuniones** — cada acta **siempre está asociada a un evento de tipo `reunión`** y es un **fichero** (PDF/doc). La directiva y el super_admin suben el fichero del acta al evento; la descarga se deja fuera de alcance por ahora. **(B) Resumen visibles para todos** — mostrar en el **dashboard** y en el **perfil** de cada miembro un resumen compacto con su **estado de pago** (Sprint 31), **posición de baile** (Sprint 33) e **instrumento asignado** (Sprint 24/33) de un vistazo.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD — event_type `reunion` | Añadir `'reunion'` como valor válido en `umsuka.events.event_type` (si no existe). Solo los eventos de tipo `reunion` pueden tener acta. |
| 2 | Migración de BD — actas como fichero | Crear `umsuka.meeting_minutes` (id, event_id FK UNIQUE → `umsuka.events` con CHECK `event_type = 'reunion'`, file_path text — ruta en Storage, file_name text, file_size INT, mime_type text, uploaded_by FK, created_at, updated_at). Un evento de reunión solo tiene un acta (uno-a-uno). Alternativa: columna `acta_file_path` directa en `events` si se prefiere sin tabla separada. |
| 3 | Supabase Storage | Crear bucket `meeting-minutes` (privado). Políticas Storage: solo directiva/super_admin pueden subir/reemplazar/eliminar; lectura para todos los miembros autenticados (sin descarga por ahora). Limitar a PDF/DOC/DOCX, máx. 10 MB. |
| 4 | RLS — actas | Directiva y super_admin pueden insertar/actualizar/eliminar el acta de un evento de reunión. Lectura para todos los miembros autenticados. Validar en BD que el `event_id` apunte a un evento tipo `reunion`. |
| 5 | Capa de negocio `lib/meetings/` | Schemas Zod (uploadMinutesSchema — valida event_id tipo reunion + fichero), queries (getMinutesByEvent, getAllMinutes — listado de reuniones con/sin acta), mutations (uploadMinutes, replaceMinutes, deleteMinutes). |
| 6 | Server actions — actas | `uploadMeetingMinutesAction(eventId, file)`, `replaceMeetingMinutesAction`, `deleteMeetingMinutesAction` — validan rol directiva/super_admin, que el evento sea tipo `reunion`, suben al bucket y guardan `meeting_minutes`. Sin acción de descarga por ahora. |
| 7 | UI — en el evento de reunión | En `/events/[id]` cuando `event_type = reunion`: sección "Acta" con estado (sin acta / acta disponible), uploader con drag & drop solo visible para directiva/super_admin y opción de reemplazar/eliminar. Mostrar nombre del fichero, tamaño y fecha de subida. Sin botón de descarga por ahora. |
| 8 | UI — listado de actas | Página `/actas` que lista **todos los eventos de tipo `reunion`** cronológicamente, con indicador de si tienen acta. Filtros por fecha y búsqueda por título del evento. Paginación. Sin descarga por ahora. |
| 9 | Capa de negocio `lib/summary/` | Función `getMemberSummary(userId)` que agrega en una sola query: estado de pago (`member_payments` — último mes pagado / al día o pendiente), posición de baile (`dance_positions` — fila/asiento o "sin asignar"), instrumento (`musician_instruments`/`instrument_assignments` — nombre del instrumento o "sin asignar"). |
| 10 | UI — Dashboard | Añadir sección "Mi resumen" en el dashboard (`/dashboard`) visible para **todos los usuarios**: 3 tarjetas/badges compactos — 💰 Pago (ej. "Al día hasta 03/2026" en verde / "Pendiente febrero" en rojo), 💃 Posición (ej. "Fila 2 — Asiento 4" o "Sin asignar"), 🎸 Instrumento (ej. "Bombo" o "Sin asignar"). Cada tarjeta enlaza a su detalle (pagos, formación, instrumentos). |
| 11 | UI — Perfil | En `/profile/[id]` y en el perfil propio, añadir bloque "Resumen" con la misma info pero ampliada (historial breve de pagos, mini-plano con posición resaltada, instrumento con foto). Visible para el propio usuario y para directiva/super_admin; opcional: visible para cualquier miembro autenticado. |
| 12 | Permisos y privacidad | El resumen de pago solo muestra estado genérico (al día/pendiente) a otros miembros, no importes detallados — detalle completo solo para el propio usuario, directiva y super_admin. Posición e instrumento son públicos entre miembros. |
| 13 | Pruebas | Tests de que solo eventos tipo `reunion` aceptan acta (rechazo si otro tipo). Tests de subida y de RLS: solo directiva sube. Tests unitarios de `getMemberSummary` con combinaciones (sin pago, con posición, sin instrumento, etc.). Tests de integración UI dashboard/perfil. Sin tests de descarga por ahora. |

### Dependencias
- Sprint 2/21 (Roles — directiva y super_admin)
- Sprint 17 (Eventos — tipo `reunion`)
- Sprint 16 (Storage — bucket y políticas)
- Sprint 19 (Perfiles — dashboard y perfil)
- Sprint 31 (Pagos — `member_payments`)
- Sprint 33 (Formación — `dance_positions`)
- Sprint 24 (Instrumentos — `musician_instruments`)

### Criterios de Aceptación
- Cada acta **siempre está asociada a un evento de tipo `reunion`** (no existe acta huérfana; FK con CHECK).
- El acta es un **fichero** (PDF/DOC/DOCX) subido a Supabase Storage (`meeting-minutes`) — **sin descarga por ahora**.
- Solo la directiva y el super_admin pueden subir, reemplazar o eliminar el acta de una reunión.
- Todos los miembros autenticados pueden ver el listado de reuniones con indicación de si tienen acta (sin descarga en esta fase).
- Un evento de reunión solo puede tener un acta a la vez (reemplazar implica sobrescribir).
- En el **dashboard** cada usuario ve su resumen de pago, posición de baile e instrumento asignado de un vistazo.
- En el **perfil** (propio y ajeno según permisos) se muestra el mismo resumen con algo más de detalle.
- Si un miembro no tiene pago/posición/instrumento, se muestra "Sin asignar" / "Pendiente" en lugar de error.
- Solo directiva/super_admin ven el detalle económico completo de otros miembros.

---

## Sprint 35 — CI/CD y Despliegue Automático

**Rama:** `feature/sprint-35-cicd`

### Descripción
Configurar GitHub Actions para linting, typecheck, tests, build y despliegue automático a Vercel desde la rama `main`.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Revisar workflows existentes | Ya existen `build.yml`, `deploy.yml`, `lint.yml`, `test.yml`. Revisar que estén completos y optimizados. |
| 2 | Workflow CI completo | Workflow que se ejecute en PRs a `develop` y `main`: lint → typecheck → test → build. |
| 3 | Workflow CD a Vercel | Mejorar `deploy.yml` para desplegar a Vercel desde `main` con preview deployments en PRs. |
| 4 | Variables de entorno | Configurar secrets en GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`. |
| 5 | Supabase db push automático | En el deploy a producción, ejecutar `supabase db push` para migraciones. |
| 6 | Preview environments | Despliegues preview por cada PR con su propia base de datos Supabase (opcional). |
| 7 | Pruebas E2E | Ejecutar tests de Playwright en el workflow de CI. |
| 8 | Documentación | Actualizar `docs/DEPLOYMENT.md` con el flujo completo. |

### Criterios de Aceptación
- Cada PR a `develop` ejecuta lint, typecheck, test y build automáticamente.
- Cada merge a `main` despliega automáticamente a Vercel.
- Las migraciones de BD se aplican automáticamente en producción.
- Los tests E2E se ejecutan en CI.
- Los preview deployments funcionan para cada PR.

---

## Sprint 36 — Hardening Final

**Rama:** `feature/sprint-36-hardening`

### Descripción
Auditorías finales de seguridad, rendimiento, accesibilidad y validación general para producción.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Auditoría de seguridad | Escanear dependencias con `npm audit` y `pnpm audit`. Revisar RLS policies. Escaneo de secretos con security-champion agent. |
| 2 | Auditoría de rendimiento | Lighthouse en páginas clave (dashboard, eventos, perfil). Optimizar imágenes, fuentes, Core Web Vitals. |
| 3 | Auditoría de accesibilidad | Verificar cumplimiento WCAG 2.1 AA. Roles ARIA, contraste de colores, navegación por teclado, lectores de pantalla. |
| 4 | Validación de seguridad | Pruebas de penetración básicas: XSS, CSRF, SQL injection, IDOR. |
| 5 | Optimización de bundle | Revisar bundle size con `next build --debug`. Code splitting y lazy loading. |
| 6 | SEO | Meta tags, Open Graph, sitemap.xml, robots.txt. |
| 7 | Validación final de features | Recorrer todas las funcionalidades implementadas verificando que cumplen los acceptance criteria. |
| 8 | Documentación final | Actualizar ADRs, ARCHITECTURE.md, DATABASE.md, DEPLOYMENT.md con el estado final. |

### Dependencias
- Todos los sprints anteriores deben estar completos.

### Criterios de Aceptación
- No hay vulnerabilidades de seguridad HIGH conocidas.
- Lighthouse scores > 90 en Performance, Accessibility, Best Practices, SEO.
- Cumplimiento WCAG 2.1 AA verificado.
- Bundle size optimizado sin regresiones.
- Toda la documentación actualizada.

---

## Resumen de Ramas y Orden de Ejecución

| Sprint | Rama | Dependencias |
|---|---|---|
| Sprint 1 — UI Redesign | `feature/sprint-01-ui-redesign` | ✅ Ejecutado |
| Sprint 2 — Workgroup Roles | `feature/sprint-02-workgroup-roles` | ✅ Ejecutado |
| Sprint 3 — Bar Pricing | `feature/sprint-03-bar-pricing` | Sprint 2 (pendiente) |
| Sprint 4 — Home Feed | `feature/sprint-04-home-feed` | ✅ Ejecutado |
| Sprint 5 — Asistencia y Ausencias | `feature/sprint-05-asistencia-ausencias` | ✅ Completado |
| Sprint 6 — Registration Approval | `feature/sprint-06-registration-approval` | ✅ Ejecutado |
| Sprint 7 — Emailless Accounts | `feature/sprint-07-emailless-accounts` | ✅ Ejecutado |
| Sprint 8 — Shifts | `feature/sprint-08-shifts` | ✅ Ejecutado |
| **Sprint 9 — Password Validation** | `feature/sprint-11-password-validation` (histórica) | ✅ Ejecutado |
| **Sprint 10 — News** | `feature/sprint-13-news` (histórica) | ✅ Ejecutado |
| **Sprint 11 — Questions** | `feature/sprint-14-questions` (histórica) | ✅ Ejecutado |
| **Sprint 12 — Shift Assignment Groups** | `feature/sprint-12-shift-assignment-groups` (histórica) | ✅ Ejecutado |
| **Sprint 13 — Workgroup Stats** | `feature/sprint-13-workgroup-stats` | ✅ Ejecutado |
| **Sprint 14 — Member List** | `feature/sprint-14-member-list` (histórica) | ✅ Ejecutado |
| Sprint 15 — Votings | `feature/sprint-15-votings` | ✅ Ejecutado |
| Sprint 16 — Document Management | `feature/sprint-16-document-management` | Sprint 6 (pendiente) |
| Sprint 17 — Events Enhancement (+ Onboarding Grupo) | `feature/sprint-17-events-enhancement` | ✅ Ejecutado |
| **Sprint 18 — Event Audience** | `feature/sprint-18-event-audience` | ✅ Ejecutado |
| Sprint 19 — Profiles & Components | `feature/sprint-19-profiles-components` | ✅ Ejecutado |
| Sprint 20 — Notifications | `feature/sprint-20-notifications` | ✅ Ejecutado |
| Sprint 21 — Admin Panel | `feature/sprint-21-admin-panel` | ✅ Ejecutado |
| **Sprint 22 — Account Deletion** | `feature/sprint-22-account-deletion` | ✅ Ejecutado (PR #24, 2026-08-20) |
| Sprint 23 — PWA | `feature/sprint-23-pwa` | Sprint 1 (pendiente) |
| Sprint 24 — Instrument Management | `feature/sprint-24-instrument-management` | Sprint 2, Sprint 19 (pendiente) |
| Sprint 25 — List Ordering | `feature/sprint-25-list-ordering` | Sprint 14, Sprint 19 (pendiente) |
| Sprint 26 — Shift Member Search | `feature/sprint-26-shift-member-search` | Sprint 8, Sprint 12 (pendiente) |
| Sprint 27 — Rehearsal Attendance | `feature/sprint-27-rehearsal-attendance` | Sprint 5, Sprint 17 (pendiente) |
| Sprint 28 — Personal Stats | `feature/sprint-28-personal-stats` | Sprint 5, Sprint 12, Sprint 27, Sprint 17 (pendiente) |
| Sprint 29 — Money Management | `feature/sprint-29-money-management` | Sprint 2, Sprint 21, Sprint 3 (pendiente) |
| Sprint 30 — Legal Guardian (Menores) | `feature/sprint-30-legal-guardian` | Sprint 6, Sprint 19, Sprint 14 (pendiente) |
| Sprint 31 — Payment Tracking & Material Distribution | `feature/sprint-31-payment-tracking` | Sprint 2, Sprint 21, Sprint 17, Sprint 19 (pendiente) |
| Sprint 32 — Rehearsal Auto-Enrollment | `feature/sprint-32-rehearsal-auto-enroll` | Sprint 2, Sprint 5, Sprint 17, Sprint 27 (pendiente) |
| Sprint 33 — Dance Formation & Musician Instruments | `feature/sprint-33-dance-formation-instruments` | Sprint 2, Sprint 17, Sprint 24, Sprint 19 (pendiente) |
| Sprint 34 — Meeting Minutes & Summary (Dashboard/Perfil) | `feature/sprint-34-meeting-minutes-summary` | Sprint 2, Sprint 21, Sprint 19, Sprint 31, Sprint 33, Sprint 24 (pendiente) |
| Sprint 35 — CI/CD | `feature/sprint-35-cicd` | — (pendiente) |
| Sprint 36 — Hardening | `feature/sprint-36-hardening` | Todos los anteriores (pendiente) |

---

## Notas Adicionales

- **Convención de commits:** Usar conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- **Pull Requests:** Cada feature branch debe mergearse a `develop` mediante PR con revisión de al menos un par.
- **Versiones:** Siguiendo SemVer, etiquetar releases en `main` (`v0.1.0`, `v0.2.0`, etc.).
- **Documentación:** Cada sprint debe generar o actualizar su ADR correspondiente en `docs/`.
- **Pruebas:** Cada sprint debe incluir tests unitarios y, cuando aplique, tests de integración.
