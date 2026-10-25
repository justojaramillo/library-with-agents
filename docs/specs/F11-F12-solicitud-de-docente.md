# F11 · F12 · Solicitar el rol de docente y aprobar o rechazar la solicitud

- **Estado:** Aprobada (la persona respondió las seis preguntas y la aprobó, 2026-10-25)
- **Rol(es):** F11: `EXTERNO` o `ESTUDIANTE` con sesión · F12: `BIBLIOTECARIO` o `ADMINISTRADOR`
- **Contrato afectado:** `app/features/accounts/schema.ts` (esquemas nuevos de la solicitud, ver «Interfaz de módulos»); `app/shared/schema.ts` no cambia; `app/shared/server/security/rate-limit.ts` (un cubo nuevo). Puerto `IdentityProvider` (`isEmailVerified`).
- **Depende de:** `docs/specs/F3-F4-roles-y-cuentas.md`, `docs/specs/F10-F16-F17-autoservicio-de-cuentas.md` y `docs/specs/S1-endurecimiento-de-seguridad.md` (aprobadas); ADR-0004 (el rol `DOCENTE` exige la verificación de un bibliotecario).
- **Fuera de esta spec pero relacionado:** F37 pone las pantallas de personal (`/solicitudes`); aquí solo se define la pantalla de la propia persona (`/docente`) y la API.

## Objetivo
Un prestatario activo puede pedir que le den el rol de docente (plazo de 30 días y cupo de 5 en vez de 15–20 días y 3), y el personal de la biblioteca decide si lo aprueba o lo rechaza. Antes se reabre la verificación del correo, que `security` señaló en F10: hoy cualquiera puede registrarse con el correo de otra persona.

## Qué hay hoy y qué cambia
- El rol de una cuenta vive solo en Firestore (`members/{uid}.role`) y **se lee en cada petición** (`createSessionResolver` → `loadMember`): al cambiar el rol, la persona lo ve en su siguiente petición, sin volver a ingresar.
- `register` (F10) no verifica la propiedad del correo: Firebase crea la identidad con `emailVerified = false` y nadie lo comprueba. No hay forma de pedir un rol de personal por la web, y `DOCENTE` no es seleccionable al registrarse.
- No existe ninguna colección de solicitudes. El modelo de dominio de `docs/features.md` ya prevé «solicitud de docente» como dato de la cuenta.
- Después de ingresar, el navegador cierra su sesión del SDK de Firebase (F4/F10); por eso **el cliente no tiene sesión de Firebase** para enviar correos de verificación sin volver a pedir la contraseña (regla 4).

## Reglas de negocio

### Verificación del correo (se reabre)
1. **Alcance (decidido por la persona):** el correo verificado se exige **solo para pedir el rol de docente** (F11). Registrarse, ingresar, buscar y pedir prestado siguen sin exigirlo. Así la ocupación de un correo ajeno no da acceso a nada sensible y no se bloquea a nadie por un correo que no llega.
2. El servidor lee la verificación **en el momento de la petición** desde Firebase Authentication (`IdentityProvider.isEmailVerified(uid)` → `getUser(uid).emailVerified`), nunca de la cookie ni del cuerpo: la cookie de sesión puede ser anterior a que la persona pulse el enlace.
3. **Envío:** al registrarse (`/registro`, F10) el navegador ya inicia sesión con el SDK de cliente; antes de cerrarla llama a `sendEmailVerification(user)`. Si ese envío falla, el registro no falla: solo se omite (la persona podrá reenviarlo, regla 4).
4. **Reenvío:** en `/docente` (regla 14), si el correo no está verificado, el botón «Enviar correo de verificación» pide la contraseña, inicia sesión con el SDK de cliente, envía el correo, cierra la sesión del SDK y muestra «Te enviamos un correo para verificar tu dirección. Cuando pulses el enlace, vuelve a esta página.». `auth/too-many-requests` → «Demasiados intentos. Espera unos minutos e inténtalo de nuevo.»; contraseña incorrecta → «Contraseña incorrecta.».
5. Las cuentas de mostrador (F3/F36) y las ya existentes quedan sin verificar; para pedir el rol de docente deben verificar el correo igual. El personal no necesita verificar nada.

### F11 · Solicitar el rol de docente
6. **`POST /api/me/teacher-request`** recibe `{ note }`: texto recortado de **10 a 500** caracteres (institución, facultad o cargo con los que el personal puede comprobar a la persona; pregunta 2). La identidad sale de la sesión, nunca del cuerpo (regla 4 de `AGENTS.md`); un `member_id` en el cuerpo se ignora.
7. **Quién puede:** solo una cuenta **activa** con rol `EXTERNO` o `ESTUDIANTE` y **correo verificado**. Orden de comprobaciones y errores:
   1. sin sesión → **401**;
   2. rol `DOCENTE` → **409** «Ya eres docente.»; rol de personal → **403** «El personal no pide el rol de docente.»;
   3. correo no verificado → **403** «Verifica tu correo para solicitar el rol de docente.»;
   4. ya existe una solicitud `PENDIENTE` → **409** «Ya tienes una solicitud pendiente.»;
   5. la última solicitud fue `RECHAZADA` hace menos de **7 días** (pregunta 3) → **409** «Tu solicitud anterior fue rechazada; podrás volver a pedirla el {fecha}.»;
   6. validación del cuerpo → **400**.
   (Las cuentas inactivas ya no tienen sesión válida: reciben 401 por el resolvedor.)
8. **Qué se guarda:** una solicitud por persona en la colección `teacher_requests`, con el id del documento **igual al `member_id`**. Eso garantiza, de forma atómica, que no hay dos solicitudes vivas de la misma persona. Crear la solicitud es una transacción: lee el documento previo (si existe y no es reintentable según la regla 7, falla con 409), lo reemplaza por la nueva en estado `PENDIENTE` con `requested_at = now` y limpia `decided_at`, `decided_by` y `reason`. El historial de rechazos anteriores **no se conserva** (pregunta 3).
9. Respuesta **201** con el `TeacherRequest`. La solicitud **no cambia el rol** ni los préstamos de la persona.
10. **Protección:** `assertSameOrigin`, sesión, y límite de tasa por cuenta (cubo `teacherRequest`: 5 por hora, clave `member_id`) antes de leer el cuerpo.
11. **`GET /api/me/teacher-request`** devuelve `{ request: TeacherRequest | null, email_verified: boolean }` de la propia sesión (sin parámetros). Prestatarios y personal: el personal recibe `request: null`.

### F12 · Aprobar o rechazar
12. **`GET /api/teacher-requests?status=&limit=&after=`** (solo personal): lista solicitudes con `status` (por defecto `PENDIENTE`), orden por `requested_at` ascendente (la más antigua primero) y luego por id, paginada como `GET /api/members` (`limit` 1–100, por defecto 50, `after` = `member_id` de la última de la página anterior; un `after` inexistente → 400). Cada elemento es un `TeacherRequestItem`: la solicitud más `member_name`, `member_email`, `member_role` y `email_verified` (leídos al listar, no copiados: no quedan viejos si la persona cambia de nombre). Si la cuenta ya no existe, el elemento se omite.
13. **`POST /api/teacher-requests/:id/approve`** y **`/reject`** (`:id` = `member_id` de la solicitud; solo personal). Ambos son una **transacción** que lee la solicitud y la cuenta:
    - solicitud inexistente → **404**; solicitud que no está `PENDIENTE` → **409** «La solicitud ya fue resuelta.» (aprobar dos veces o aprobar una ya rechazada);
    - **aprobar**: además exige cuenta **activa**, con rol `EXTERNO` o `ESTUDIANTE` (si no, **409** «La cuenta ya no puede recibir el rol de docente.») y correo **todavía verificado** (si no, **409** «El correo de la persona ya no está verificado.»). Efecto: `members/{id}.role = "DOCENTE"` y la solicitud pasa a `APROBADA` con `decided_at = now` y `decided_by = <member_id del actor>`, todo en la misma transacción. Respuesta **200** con el `TeacherRequest` actualizado;
    - **rechazar**: recibe `{ reason? }` (texto recortado, hasta **300** caracteres; opcional). Efecto: `RECHAZADA` con `decided_at`, `decided_by` y `reason`; el rol no cambia. Respuesta **200**. Rechazar no exige que la cuenta siga activa ni verificada.
14. **Aprobar no recalcula nada:** los préstamos activos de la persona conservan su fecha de vencimiento; el cupo de 5 y los 30 días rigen desde el siguiente préstamo (ADR-0004, `docs/features.md`). El personal no puede aprobar su propia solicitud porque no puede crearla (regla 7.2).
15. **Protección de las rutas de personal:** `assertSameOrigin` → `requireStaff` → validación del `:id` con `IdSchema` → servicio. Sin límite de tasa propio (la sesión de personal ya está autenticada).
16. **El rol de docente no se quita** (decidido por la persona): no hay ruta ni pantalla para degradarlo.

### Pantalla de la persona
17. **`/docente`** (con sesión; sin sesión redirige a `/login`; personal: mensaje «El personal no pide el rol de docente.» sin formulario). Lee la sesión dentro de `<Suspense>` con `await connection()` (S1, regla 1). Título «Solicitar el rol de docente». Según el estado:
    - `DOCENTE`: «Ya tienes el rol de docente.» con el plazo y el cupo vigentes (30 días, 5 préstamos);
    - correo no verificado **y se iba a mostrar el formulario** (sin solicitud, o rechazo ya reintentable): aviso «Verifica tu correo» y el botón de la regla 4 (el formulario no aparece). Una solicitud `PENDIENTE` o `RECHAZADA` se muestra aunque el correo ya no esté verificado, porque el correo solo se exige para crear;
    - sin solicitud, o `RECHAZADA` ya reintentable: formulario con «Institución, facultad o cargo» (`textarea`, 10–500, contador de caracteres) y botón «Enviar solicitud»;
    - `PENDIENTE`: «Tu solicitud está pendiente. El personal la revisará.» con la fecha en que se envió;
    - `RECHAZADA` aún no reintentable: «Tu solicitud fue rechazada el {fecha}. Motivo: {reason}. Podrás volver a pedirla el {fecha}.» (si no hay motivo, sin esa frase).
    Mensajes de error en `role="alert"` enlazados por `aria-describedby`; el botón se deshabilita mientras envía; 429 → «Demasiadas solicitudes. Inténtalo más tarde.».
18. **Enlace en la barra:** a los tres roles de prestatario la barra de navegación (F33) les muestra un enlace a `/docente`: «Ser docente» si el rol es `EXTERNO` o `ESTUDIANTE`, y «Mi rol de docente» si ya es `DOCENTE`. Así, al ingresar, la persona encuentra en `/docente` el resultado de su solicitud (aprobada, rechazada o pendiente) y comprueba que su perfil cambió, sin indicador ni aviso aparte (pregunta 6). El personal no ve el enlace.
19. Las pantallas del personal (`/solicitudes`, F37) quedan fuera de esta spec; mientras tanto el personal puede usar la API directamente. Solo se define lo que F37 consume (reglas 12–13).

## Entradas y salidas
| Operación | Entrada | Salida |
| --- | --- | --- |
| `POST /api/me/teacher-request` | `{ note }` | 201 `TeacherRequest` · 400 · 401 · 403 (personal o correo sin verificar o origen) · 409 (ya docente, pendiente, rechazo reciente) · 429 |
| `GET /api/me/teacher-request` | — | 200 `{ request: TeacherRequest \| null, email_verified }` · 401 |
| `GET /api/teacher-requests` | `?status=&limit=&after=` | 200 `{ requests: TeacherRequestItem[], next_after }` · 400 · 401 · 403 |
| `POST /api/teacher-requests/:id/approve` | — | 200 `TeacherRequest` · 400 (`:id`) · 401 · 403 · 404 · 409 |
| `POST /api/teacher-requests/:id/reject` | `{ reason? }` | 200 `TeacherRequest` · 400 · 401 · 403 · 404 · 409 |

Errores esperados (clase → cuándo): `UnauthorizedError` sin sesión · `ForbiddenError` rol de personal en F11, prestatario en F12, correo sin verificar, origen distinto · `NotFoundError` solicitud inexistente (F12) · `ConflictError` estados incompatibles (reglas 7 y 13) · `ZodError` → 400 · límite de tasa → 429 con `Retry-After`.

## Autorización
- **F11 (crear y leer la propia):** `EXTERNO` y `ESTUDIANTE` activos. `DOCENTE` y personal reciben los errores de la regla 7; sin sesión, 401.
- **F12 (listar, aprobar, rechazar):** `BIBLIOTECARIO` y `ADMINISTRADOR` activos (`requireStaff`). Un prestatario (incluido el dueño de la solicitud) → 403; sin sesión → 401.
- Un prestatario nunca ve solicitudes ajenas ni puede aprobar la suya: no existe ninguna ruta que acepte un `member_id` del cliente en F11.

## Criterios de aceptación
- **Dado** un `ESTUDIANTE` activo con correo verificado, **cuando** envía `{ note }` de 10 caracteres, **entonces** 201, la solicitud queda `PENDIENTE` y su rol sigue siendo `ESTUDIANTE`.
- **Dado** un `note` de 9 caracteres, de 501, vacío o solo espacios, **entonces** 400 y no se crea nada; de 10 y de 500, 201.
- **Dado** un cuerpo con `member_id` o `status: "APROBADA"`, **entonces** se ignoran: la solicitud es de la sesión y queda `PENDIENTE`.
- **Dado** un correo **sin verificar**, **entonces** 403 con el mensaje de verificación y no se crea nada; **dado** que la persona pulsa el enlace de Firebase, **cuando** repite la petición **sin volver a ingresar**, **entonces** 201.
- **Dado** una solicitud `PENDIENTE`, **cuando** vuelve a enviar, **entonces** 409; **dado** dos envíos simultáneos, **entonces** exactamente uno responde 201 y el otro 409.
- **Dado** una solicitud rechazada hace 6 días 23 h, **cuando** vuelve a enviar, **entonces** 409 con la fecha; hace 7 días exactos, **entonces** 201 y la nueva reemplaza a la anterior (`decided_at`, `decided_by` y `reason` vuelven a `null`).
- **Dado** un `DOCENTE`, **entonces** 409; **dado** un bibliotecario o un administrador, **entonces** 403; **dado** una petición sin sesión, **entonces** 401; **dado** un `POST` de otro origen, **entonces** 403.
- **Dado** 6 envíos en una hora de la misma cuenta, **entonces** el 6.º recibe 429 con `Retry-After`; otra cuenta no se ve afectada.
- **Dado** un bibliotecario, **cuando** pide `GET /api/teacher-requests`, **entonces** ve las pendientes de la más antigua a la más reciente con nombre, correo y `email_verified`; un `ESTUDIANTE` recibe 403 y sin sesión 401.
- **Dado** una solicitud pendiente, **cuando** el bibliotecario aprueba, **entonces** 200, la cuenta pasa a `DOCENTE`, la solicitud a `APROBADA` con `decided_by` = el bibliotecario, y en la **siguiente petición** de la persona su sesión ya tiene rol `DOCENTE` (plazo de 30 días y cupo de 5 en su siguiente préstamo; los préstamos abiertos no cambian).
- **Dado** una solicitud ya `APROBADA` o `RECHAZADA`, **cuando** se aprueba o se rechaza otra vez, **entonces** 409 y nada cambia; **dado** dos aprobaciones simultáneas, **entonces** exactamente una responde 200.
- **Dado** que la cuenta fue desactivada, o que ya es `DOCENTE`, o que su correo dejó de estar verificado, **cuando** se intenta aprobar, **entonces** 409 y la solicitud sigue `PENDIENTE`.
- **Dado** que se rechaza con `reason` de 300 y de 301 caracteres, **entonces** 200 y 400; sin `reason`, 200; el rol no cambia.
- **Dado** un `:id` inexistente, **entonces** 404; con un `:id` mal formado (`a/b`), **entonces** 400.
- **Dado** una solicitud cuya cuenta fue borrada, **entonces** el listado la omite sin fallar.
- **Dado** la pantalla `/docente` en cada estado de la regla 17, **entonces** muestra exactamente el texto indicado; a 360, 768 y 1024 px no hay desplazamiento horizontal y se usa solo con teclado.
- **Dado** `/registro` con un registro correcto, **entonces** se envía el correo de verificación antes de cerrar la sesión del SDK; si el envío falla, el registro termina igual.

## Bordes
- `note`: 9, 10, 500 y 501 caracteres; con saltos de línea; con espacios alrededor (se recorta antes de contar); caracteres Unicode (tildes, emojis: se cuentan como caracteres de Zod).
- `reason`: ausente, `""` (equivale a ausente), 300 y 301.
- Estados: sin solicitud previa · `PENDIENTE` · `APROBADA` (la cuenta ya es docente) · `RECHAZADA` hace 0 s, 6 d 23 h 59 min, 7 d.
- Cuenta: desactivada entre la solicitud y la aprobación · rol cambiado a `DOCENTE` por otra vía · correo cambiado a no verificado.
- Concurrencia: doble clic en «Enviar solicitud»; dos bibliotecarios aprobando o uno aprobando y otro rechazando a la vez (gana uno, el otro 409).
- Listado: 0 solicitudes, 1, 50, 51 (paginación), `after` inexistente, `status` inválido → 400.
- Sesión: cookie expirada o cuenta inactiva → 401 en todas las rutas.

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `accounts/schema.ts` | orquestador | `TeacherRequestStatusSchema = z.enum(["PENDIENTE","APROBADA","RECHAZADA"])`; `TEACHER_REQUEST_RULES = { noteMin: 10, noteMax: 500, reasonMax: 300, retryAfterDays: 7 }`; `CreateTeacherRequestInputSchema = { note }`; `RejectTeacherRequestInputSchema = { reason?: string }`; `TeacherRequestSchema = { member_id, note, status, requested_at, decided_at: nullable, decided_by: nullable, reason: nullable }` (fechas ISO como en `Loan`); `TeacherRequestItemSchema = TeacherRequest + { member_name, member_email, member_role, email_verified }`; `ListTeacherRequestsQuerySchema = { status = "PENDIENTE", limit 1–100 = 50, after?: Id }`; `TeacherRequestPageSchema = { requests: TeacherRequestItem[], next_after: Id \| null }`; `MyTeacherRequestSchema = { request: TeacherRequest \| null, email_verified: boolean }` |
| `accounts/server/identity.ts` (+ `.firebase`, `.memory`) | backend | `isEmailVerified(uid): Promise<boolean>` (Firebase: `getUser(uid).emailVerified`; si el usuario no existe, `false`). La versión en memoria permite marcarlo en las pruebas |
| `accounts/server/teacher-request-repository.ts` (+ `.memory`, `.firestore`) | backend | Puerto: `get(memberId)`, `create(request, retryAfter: Date)` (transacción de la regla 8; `ConflictError` si es `PENDIENTE` o si el rechazo aún no es reintentable), `list(status, limit, after?)` (con `hasMore`), `decide(memberId, decision, actor, now)` (transacción de la regla 13: lee solicitud y cuenta, aplica el rol si se aprueba) |
| `accounts/server/teacher-request-service.ts` | backend | `request(actor, input, now)`, `getMine(actor)`, `list(actor, query)`, `approve(actor, id, now)`, `reject(actor, id, input, now)`. Reglas 6–15; usa `isEmailVerified` en el momento de crear y de aprobar. El tiempo se inyecta (`now`) |
| `container.ts` | backend | Conectar el servicio nuevo (solo `accounts`; no cruza con otras features) |
| `rate-limit.ts` | backend | `RATE_LIMITS.teacherRequest = { limit: 5, windowMs: 3_600_000 }` |
| `app/api/me/teacher-request/route.ts` · `app/api/teacher-requests/route.ts` · `…/[id]/approve/route.ts` · `…/[id]/reject/route.ts` | backend | Reglas 6–15 (`assertSameOrigin`, `requireSession`/`requireStaff`, límite de tasa, `Schema.parse`, `handleError`) |
| `accounts/ui/teacher-request-form.tsx` · `app/docente/page.tsx` | frontend | Regla 17; función pura `describeTeacherRequestState<T>(…)` para probar los textos sin navegador |
| `accounts/ui/auth-client.ts` · `register-form.tsx` | frontend | `sendVerificationEmail(email, password)` (inicia sesión, envía, cierra la del SDK); `register-form` lo llama sin hacer fallar el registro (reglas 3–4) |
| `accounts/ui/nav-bar.tsx` | frontend | Enlace «Ser docente» (regla 18) |
| Pruebas | tests | Todos los criterios con repositorio e identidad en memoria; rutas HTTP (401/403/404/409/429 y `Retry-After`); atomicidad (doble envío y doble aprobación simultáneos); `describeTeacherRequestState`; render inicial de `/docente` con `renderToStaticMarkup`; el cambio de rol se ve en la siguiente resolución de sesión |

Reparto sugerido: orquestador fija `schema.ts` → **backend** (puerto de identidad, repositorio, servicio, rutas, contenedor) ∥ **frontend** (`/docente`, formulario, barra, `register-form`) ∥ **tests** → `npm run check:full` → `security` → handoff. Las transacciones de Firestore ya tienen precedente en `loans` (F5–F8) y en el alta del administrador (`meta/admin`).

## Fuera de alcance
Pantallas de personal (`/solicitudes`, F37), quitar o degradar el rol de docente, subir documentos como prueba (la prueba es solo texto), notificar por correo la decisión a la persona (la ve en `/docente`), historial de solicitudes anteriores, verificación del correo como requisito para ingresar o para pedir prestado, cambiar el correo de una cuenta, límite de tasa global (ADR-0008), creación de bibliotecarios (F13) y desactivar cuentas (F14).

## Preguntas abiertas
### Resueltas (la persona respondió)
1. **Verificación del correo:** se exige **solo para solicitar el rol de docente** (reglas 1–5); registrarse, ingresar y pedir prestado no la exigen.
2. **La nota:** **obligatoria**, de 10 a 500 caracteres (regla 6).
4. **Quién decide:** **ambos**, `BIBLIOTECARIO` y `ADMINISTRADOR`. El administrador es el dueño del sistema y puede hacer todo lo que hace el personal; la responsabilidad administrativa de las solicitudes es del bibliotecario (reglas 12–15).
5. **Quitar el rol de docente:** **no se quita.** El rol `DOCENTE` existe para las reglas de préstamo (30 días, cupo de 5, 3 renovaciones) y para que los estudiantes construyan funcionalidades de mayor dificultad. No hay que construir nada para degradarlo (regla 16).

6. **Aviso a la persona:** **sin indicador en la barra.** La persona ve la decisión al ingresar y abrir `/docente`, que sigue accesible desde la barra también para los docentes (regla 18).
3. **Nueva solicitud tras un rechazo:** **7 días** de espera; la nueva solicitud reemplaza a la anterior y no se guarda historial (reglas 7.5 y 8).
