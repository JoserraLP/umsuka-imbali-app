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

### Descripción
Añadir roles específicos de responsable para grupos de trabajo (telas, barra, estandarte, limpieza). Solo estos responsables podrán registrar si una persona ha participado o no en su turno de trabajo.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columna `workgroup` a `umsuka.profiles` (enum: `telas`, `barra`, `estandarte`, `limpieza`, `ninguno`). Añadir columna `is_workgroup_lead` booleana. Crear índices. |
| 2 | Migración de BD — tabla workgroup_attendance | Crear `umsuka.workgroup_attendance` (id, shift_id, user_id, workgroup, attended, marked_by, timestamps) con RLS. |
| 3 | Helper functions | Añadir `umsuka.is_workgroup_lead(workgroup text)` y `umsuka.current_user_workgroup()` en SQL. |
| 4 | Actualizar tipos | Regenerar `src/types/database.types.ts` con `supabase gen types`. |
| 5 | Capa de negocio `lib/workgroups/` | Crear schemas Zod, queries y mutations para la gestión de asistencia por grupo de trabajo. |
| 6 | Server actions | Acciones para marcar/desmarcar asistencia de miembros en un turno, validando que el actor sea el lead del grupo correspondiente. |
| 7 | UI de gestión | Panel en la página de evento/detalle de turno donde el responsable pueda ver los miembros de su grupo y marcar asistencia. |
| 8 | Actualizar políticas RLS | Asegurar que `workgroup_attendance` solo sea visible/editable por el lead del grupo correspondiente + super_admin. |

### Dependencias
- Sprint 1 (UI/UX para los nuevos paneles)

### Criterios de Aceptación
- Existe el rol de "responsable de telas", "responsable de barra", "responsable de estandarte", "responsable de limpieza".
- Solo el responsable de un grupo puede marcar asistencia para los miembros de su grupo.
- Un responsable no puede marcar asistencia para miembros de otros grupos.
- Super admin puede ver y gestionar todos los grupos.

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

### Descripción
Rediseñar la página principal (`/dashboard`) para mostrar: feed de los últimos posts de Instagram de la cuenta oficial de Umsuka, notificaciones del usuario y eventos próximos del calendario.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Integración Instagram API | Crear servicio `src/lib/social/instagram.ts` que obtenga los últimos posts usando Instagram Basic Display API o Graph API. |
| 2 | Caché de posts | Almacenar posts en Supabase (`umsuka.instagram_posts`) con TTL para evitar rate limiting. |
| 3 | Server component de feed | Crear `InstagramFeed` que renderice los últimos 6-9 posts en cuadrícula. |
| 4 | Widget de notificaciones | Consultar `umsuka.notifications` (a implementar en Sprint 14) y mostrar las últimas 5 no leídas. |
| 5 | Widget de calendario | Consultar `umsuka.events` ordenados por fecha ascendente, mostrar los próximos 3-5 eventos. |
| 6 | Diseño de dashboard | Maquetar las 3 secciones en columnas: feed central (Instagram), sidebar derecha (notificaciones + calendario). |
| 7 | Actualizar `dashboard/page.tsx` | Refactorizar para usar los nuevos widgets. |
| 8 | Pruebas | Tests de integración para cada widget. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 14 (Notificaciones) — si se quiere integración real; si no, se puede hacer primero con datos mock.

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
| 7 | Notificación al usuario | Opcional: enviar notificación interna cuando el usuario sea aprobado (depende de Sprint 14). |
| 8 | Pruebas | Tests de integración para el flujo completo de aprobación. |

### Dependencias
- Sprint 5 (para tener el panel admin funcional)

### Criterios de Aceptación
- Al registrarse con Google, el perfil se crea con status `pending`.
- El usuario pendiente ve una pantalla informativa y no puede acceder a ninguna funcionalidad.
- Un super admin puede aprobar o suspender usuarios desde el panel de administración.
- Al ser aprobado, el usuario puede acceder a la aplicación normalmente.

---

## Sprint 7 — Turnos: Creación, Asignación y Control de Conflictos

**Rama:** `feature/sprint-07-shifts`

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
- Sprint 6 (para tener management roles claros)

### Criterios de Aceptación
- Los management pueden crear turnos asociados a un evento con hora de inicio y fin.
- Los management pueden asignar miembros a turnos.
- El sistema detecta y advierte sobre conflictos horarios al asignar un miembro.
- Los miembros pueden ver sus turnos asignados en su perfil.
- No se puede asignar a un miembro a dos turnos que solapen.

---

## Sprint 8 — Noticias: Publicación y Gestión

**Rama:** `feature/sprint-08-news`

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
| 7 | Notificaciones | Al crear una noticia, enviar notificación push/Interna a todos los miembros (depende de Sprint 14). |
| 8 | Pruebas | Tests unitarios e integración. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 14 (Notificaciones — opcional para MVP)

### Criterios de Aceptación
- Los management pueden crear, editar y eliminar noticias.
- Todos los miembros autenticados pueden ver las noticias.
- Las noticias se muestran ordenadas por fecha (más reciente primero).
- Las noticias importantes pueden fijarse al inicio.

---

## Sprint 9 — Preguntas: Consultas y Seguimiento

**Rama:** `feature/sprint-09-questions`

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

## Sprint 10 — Votaciones

**Rama:** `feature/sprint-10-votings`

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

## Sprint 11 — Gestión Documental (Supabase Storage)

**Rama:** `feature/sprint-11-document-management`

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

## Sprint 12 — Eventos: Mejora de Registro y Gestión

**Rama:** `feature/sprint-12-events-enhancement`

### Descripción
Mejorar la gestión de eventos: registro con campos adicionales, comentarios, capacidad máxima, y lista de espera.

### Pasos

| # | Paso | Detalle |
|---|---|---|
| 1 | Migración de BD | Añadir columnas a `umsuka.events`: `max_attendees`, `registration_deadline`, `location`, `image_url`. Crear `umsuka.event_comments` si se desea. |
| 2 | Capa `lib/events/` | Mejorar schemas existentes con los nuevos campos. |
| 3 | Lógica de lista de espera | Si el evento está lleno, los nuevos registros van a lista de espera (`umsuka.event_waitlist`). |
| 4 | UI: Página de evento | Rediseñar `/events/[id]` con toda la info: fecha, lugar, aforo, botón de registro, comentarios. |
| 5 | UI: Calendario de eventos | Vista de calendario mensual/semanal con todos los eventos. |
| 6 | Pruebas | Tests de integración. |

### Dependencias
- Sprint 1 (UI/UX)
- Sprint 5 (asistencia)

### Criterios de Aceptación
- Los eventos tienen capacidad máxima y fecha límite de registro.
- Si el evento está lleno, los miembros pueden apuntarse a la lista de espera.
- Se muestra claramente el estado del evento y del registro del usuario.

---

## Sprint 13 — Perfiles y Componentes

**Rama:** `feature/sprint-13-profiles-components`

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

## Sprint 14 — Notificaciones

**Rama:** `feature/sprint-14-notifications`

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

## Sprint 15 — Administración: Panel de Control

**Rama:** `feature/sprint-15-admin-panel`

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
- Sprint 13 (perfiles completos)

### Criterios de Aceptación
- Los super admin pueden ver y gestionar todos los usuarios (cambiar roles, activar/suspender).
- La configuración global es modificable desde el panel.
- Cada acción administrativa queda registrada en el log de auditoría.
- Los logs son consultables con filtros.

---

## Sprint 16 — PWA: Progressive Web App

**Rama:** `feature/sprint-16-pwa`

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
| 7 | Pruebas | Verificar instalación en Chrome, Firefox, Safari iOS, Edge. Probar offline mode. |

### Criterios de Aceptación
- La aplicación es instalable en navegadores compatibles (Chrome, Edge, Safari iOS).
- Los assets estáticos se cachean y funcionan offline.
- La aplicación muestra una página offline personalizada.
- El manifest.json tiene todos los campos requeridos.
- Los iconos se muestran correctamente después de la instalación.

---

## Sprint 17 — CI/CD y Despliegue Automático

**Rama:** `feature/sprint-17-cicd`

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

## Sprint 18 — Hardening Final

**Rama:** `feature/sprint-18-hardening`

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
| Sprint 1 — UI Redesign | `feature/sprint-01-ui-redesign` | — |
| Sprint 2 — Workgroup Roles | `feature/sprint-02-workgroup-roles` | Sprint 1 |
| Sprint 3 — Bar Pricing | `feature/sprint-03-bar-pricing` | Sprint 2 |
| Sprint 4 — Home Feed | `feature/sprint-04-home-feed` | Sprint 1 |
| Sprint 5 — Asistencia y Ausencias | `feature/sprint-05-asistencia-ausencias` | ✅ Completado |
| Sprint 6 — Registration Approval | `feature/sprint-06-registration-approval` | Sprint 5 |
| Sprint 7 — Shifts | `feature/sprint-07-shifts` | Sprint 1, Sprint 6 |
| Sprint 8 — News | `feature/sprint-08-news` | Sprint 1 |
| Sprint 9 — Questions | `feature/sprint-09-questions` | Sprint 1 |
| Sprint 10 — Votings | `feature/sprint-10-votings` | Sprint 1, Sprint 6 |
| Sprint 11 — Document Management | `feature/sprint-11-document-management` | Sprint 6 |
| Sprint 12 — Events Enhancement | `feature/sprint-12-events-enhancement` | Sprint 1, Sprint 5 |
| Sprint 13 — Profiles & Components | `feature/sprint-13-profiles-components` | Sprint 1 |
| Sprint 14 — Notifications | `feature/sprint-14-notifications` | Múltiples |
| Sprint 15 — Admin Panel | `feature/sprint-15-admin-panel` | Sprint 6, Sprint 13 |
| Sprint 16 — PWA | `feature/sprint-16-pwa` | Sprint 1 |
| Sprint 17 — CI/CD | `feature/sprint-17-cicd` | — |
| Sprint 18 — Hardening | `feature/sprint-18-hardening` | Todos los anteriores |

---

## Notas Adicionales

- **Convención de commits:** Usar conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- **Pull Requests:** Cada feature branch debe mergearse a `develop` mediante PR con revisión de al menos un par.
- **Versiones:** Siguiendo SemVer, etiquetar releases en `main` (`v0.1.0`, `v0.2.0`, etc.).
- **Documentación:** Cada sprint debe generar o actualizar su ADR correspondiente en `docs/`.
- **Pruebas:** Cada sprint debe incluir tests unitarios y, cuando aplique, tests de integración.
