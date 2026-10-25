## Entrega: orquestador · F11 + F12 (solicitar el rol de docente y aprobarlo o rechazarlo)
**Hecho:**
- **F11:** `POST` y `GET /api/me/teacher-request` y pantalla `/docente` con todos sus estados (personal, docente, correo sin verificar, formulario, pendiente, rechazada). Nota obligatoria de 10 a 500 caracteres, correo verificado solo para crear, espera de 7 días tras un rechazo, 5 solicitudes por hora por cuenta. Enlace «Ser docente» / «Mi rol de docente» en la barra para los tres roles de prestatario.
- **F12:** `GET /api/teacher-requests` (paginado, pendientes por defecto, de la más antigua a la más reciente) y `POST /api/teacher-requests/:id/approve` y `/reject`, para `BIBLIOTECARIO` y `ADMINISTRADOR`. Aprobar cambia el rol a `DOCENTE` y marca la solicitud en una sola transacción; el rol nuevo se ve en la siguiente petición de la persona. El rol de docente no se quita (decidido).
- **Verificación del correo:** `IdentityProvider.isEmailVerified` (Admin `getUser`, leído en el momento). `/registro` envía el correo de verificación sin hacer fallar el registro; `/docente` permite reenviarlo pidiendo la contraseña.
- Revisión de `security`: **Aprobado**, sin críticos ni altos.

**Archivos:** contrato en `app/features/accounts/schema.ts`; backend en `app/features/accounts/server/{teacher-request-*,identity*,repository.memory}.ts`, `app/features/container.ts`, `app/shared/server/{collections,security/rate-limit}.ts`, `app/api/me/teacher-request/`, `app/api/teacher-requests/`; frontend en `app/features/accounts/ui/{teacher-request-*,verify-email-form,auth-client,register-form,nav-bar}`, `app/docente/`; `firestore.indexes.json`; pruebas en `app/features/accounts/tests/teacher-request-*.test.ts`, `identity-email-verified.test.ts`, `verification-email-client.test.ts`, `tests/helpers/teacher-requests.ts`.

**Cómo verificar:** `npm run check:full` → 1833 pruebas en verde y build con `/docente` y las cuatro rutas nuevas.

**Decisiones:** constan solo en `docs/specs/F11-F12-solicitud-de-docente.md`.

**Pendiente / bloqueos:**
- **Índice de Firestore (lo hace la persona):** el listado del personal necesita el índice compuesto `teacher_requests` (`status` ASC, `requested_at` ASC), declarado en `firestore.indexes.json` (publicarlo con `firebase deploy --only firestore:indexes` o crearlo en la consola). Sin él, `GET /api/teacher-requests` responde 500 en Firebase real; el emulador y las pruebas no lo exigen.
- **Probar tras desplegar:** registrar una cuenta (llega el correo de verificación), solicitar el rol sin verificar (debe pedir verificar), verificar, solicitar, aprobar con un bibliotecario, y ver el cambio en `/docente` y en el plazo del siguiente préstamo; también rechazar y comprobar la espera de 7 días.
- **Revisión visual** de `/docente` a 360, 768 y 1024 px (nadie la ha mirado) y del comportamiento interactivo de los tres formularios (sin pruebas de navegador).
- **De `security` (Medios y Bajos, sin cambio de código ahora):**
  - Correo de Firebase distinto de `members.email`: `isEmailVerified` no comprueba que el correo verificado sea el de la cuenta. Sin vía para cambiar el correo hoy es riesgo bajo, pero **hay que cerrarlo antes de construir cualquier «cambiar correo»** (que el puerto devuelva `{ verified, email }` y se compare).
  - Caracteres Unicode de control, de ancho cero o bidi en `note` y `reason` (10 × U+200B pasa el mínimo): filtrarlos **antes de F37**, que los muestra al personal.
  - `note` sin tope en el esquema crudo de la ruta (el 400 llega tras dos llamadas externas); el listado hace un `getUser` por elemento (hasta 100); `create` no lee la cuenta dentro de la transacción (inofensivo, `decide` revalida); el repositorio en memoria no es estrictamente atómico (solo pruebas).
  - El contador del formulario cuenta puntos de código y el contrato unidades UTF-16: con emojis pueden discrepar (las pruebas fijan el comportamiento actual; revisar).
- **Sin pruebas:** el adaptador `identity.firebase.ts`, el repositorio de Firestore de solicitudes (emulador, igual que `loans`), el render de `/docente` con sesión y los formularios en el navegador.

**Dudas de la especificación:** formato exacto de las fechas en el mensaje 409 de la API (hoy «2 de noviembre de 2026»); qué hacer con una solicitud `APROBADA` si la cuenta deja de ser docente por otra vía (no se quita el rol, así que no ocurre hoy).
