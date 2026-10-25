# F10 · F16 · F17 · Autorregistro, recuperar contraseña y límite de intentos de ingreso

- **Estado:** Aprobada (la persona respondió las cuatro preguntas y pidió construir, 2026-10-26)
- **Rol(es):** público (sin sesión)
- **Contrato afectado:** `app/features/accounts/schema.ts` (`ForgotPasswordInputSchema`); `app/shared/server/security/rate-limit.ts` (dos cubos nuevos, `RATE_LIMITS`). `app/shared/schema.ts` no cambia.
- **Depende de:** `docs/specs/F3-F4-roles-y-cuentas.md` (aprobada), `docs/specs/S1-endurecimiento-de-seguridad.md` y `docs/adr/0008-limite-de-tasa-y-cache-del-catalogo.md`.
- **Decisiones:** ADR-0003 (las credenciales viven en Firebase Authentication y el ingreso se hace en el navegador con el SDK), `docs/frontend-rules.md`.

## Objetivo
Una persona sin cuenta puede crearse una cuenta de `EXTERNO` o `ESTUDIANTE` (F10), una persona que olvidó su contraseña puede restablecerla ella misma con el correo de Firebase (F16), y el ingreso queda protegido contra adivinar contraseñas (F17).

## Qué hay hoy y qué cambia
- `MemberService.register` ya existe y valida el rol (solo `EXTERNO` o `ESTUDIANTE`, por defecto `EXTERNO`); hoy solo lo alcanza el personal por `POST /api/members` (F3). F10 lo abre al público por una ruta nueva.
- El ingreso se hace en el navegador (`signInWithEmailAndPassword`) y el servidor solo recibe un `id_token` ya válido (`POST /api/auth/login`). **Por eso el servidor nunca ve los intentos fallidos de contraseña**: no puede contarlos él mismo (afecta a F17, ver sus reglas).
- El servidor no puede enviar correos (el Admin SDK solo genera el enlace, no lo manda); por eso F16 usa el SDK de cliente, que sí lo envía (enmienda a `docs/features.md`: no existe `POST /api/auth/forgot-password`).

## Reglas de negocio

### F10 · Autorregistro
1. **`POST /api/auth/register`** (pública) recibe `CreateMemberInput` (`name`, `email`, `password`, `role` opcional). `role` solo puede ser `EXTERNO` o `ESTUDIANTE`; ausente → `EXTERNO`; cualquier otro valor (`DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR`, vacío, mayúsculas distintas…) → **400** y no se crea nada. El rol nunca se toma de la sesión ni de otro campo.
2. La cuenta queda **activa**, con el correo en minúsculas y recortado. Un correo ya registrado → **409** con el mensaje «Ya existe una cuenta con ese correo.» (decisión sobre qué revela, ver pregunta 3). Contraseña de 8 a 100 caracteres (contrato actual). El correo admite hasta **254** caracteres (el máximo práctico); con 255 o más → 400 (en registro, en recuperación y en el ingreso).
3. Respuesta **201** con el `Member` público (nunca contraseña ni `search_keys`). La ruta **no** crea sesión: la pantalla ingresa después con el SDK de cliente (regla 6).
4. **Protección de la ruta:** `assertSameOrigin` primero; luego límite de tasa por IP (cubo `register`: 10 por hora, `clientKey`; sin IP válida no se limita, como en S1); luego la validación. Sin sesión requerida; si el visitante ya tiene sesión, la ruta funciona igual (no la cambia).
5. **Atomicidad y limpieza:** la creación en Firebase Authentication y el documento `members/{uid}` siguen siendo los de `register` (si falla guardar el documento, se borra la identidad; si ese borrado falla, queda una identidad huérfana que `npm run reconcile:identities` informa).
6. **Pantalla `/registro`** (pública): título «Crear cuenta»; formulario con «Nombre» (obligatorio, máx. 120), «Correo», «Contraseña» (8–100, con el texto de ayuda «Entre 8 y 100 caracteres»), «Confirmar contraseña» (solo en el navegador; si no coincide, «Las contraseñas no coinciden.» y no se envía), y un grupo `fieldset`/`legend` «Soy» con dos opciones (`radio`): «Externo» (por defecto) y «Estudiante»; botón «Crear cuenta». Enlace «¿Ya tienes cuenta? Ingresar» (a `/login`).
7. **Flujo de la pantalla:** envía `POST /api/auth/register`; si responde 201, ingresa con `signInWithEmailAndPassword` y envía el `id_token` a `POST /api/auth/login` (mismo código que `/login`; se extrae a un ayudante compartido), cierra la sesión del SDK de cliente, y lleva a `/` con recarga. Si el registro salió bien pero el ingreso automático falla, muestra «Tu cuenta se creó. Ingresa con tu correo y contraseña.» con un enlace a `/login`. Errores del servidor: se muestra su mensaje (validado con `ApiErrorSchema`); 429 → «Demasiados registros desde tu conexión. Inténtalo más tarde.»; fallo de red → «No se pudo crear la cuenta». Los mensajes van en `role="alert"` enlazado por `aria-describedby`. El botón se deshabilita mientras envía (sin doble envío).
8. Un `Member` creado así no tiene permisos de personal ni de docente; el plazo y el cupo salen de su rol vigente (F5).

### F16 · Recuperar la contraseña
9. **Pantalla `/recuperar`** (pública): título «Recuperar contraseña»; un campo «Correo» y el botón «Enviar enlace». Valida el formato con `ForgotPasswordInputSchema` en el navegador (un correo mal formado → «Escribe un correo válido.» sin llamar a Firebase). Enlaces a `/login` y `/registro`.
10. **Envío:** `sendPasswordResetEmail(getClientAuth(), email)` del SDK de cliente. No hay ruta propia ni se guarda nada. La persona restablece su contraseña en la página de Firebase a la que lleva el enlace del correo; el personal nunca restablece contraseñas ajenas.
11. **Mismo mensaje exista o no la cuenta:** tras enviar, siempre «Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de spam.» (`role="status"`). El código `auth/user-not-found` se trata como éxito. `auth/invalid-email` → el mensaje de formato de la regla 9. `auth/too-many-requests` → «Demasiados intentos. Espera unos minutos e inténtalo de nuevo.». Cualquier otro error (red, configuración) → «No se pudo enviar el enlace. Inténtalo de nuevo.».
12. Una cuenta **inactiva** puede restablecer su contraseña en Firebase, pero sigue sin poder ingresar (`Credenciales inválidas`, F4): restablecer no reactiva nada.
13. **La persona (no los agentes) debe revisar en la consola de Firebase** (*Authentication → Plantillas*) que la plantilla «Restablecer contraseña» esté en español y con el remitente que prefiera, y que el dominio de la aplicación figure en los dominios autorizados. Se anota en el handoff.

### F17 · Límite de intentos de ingreso fallidos
14. **Lo que el servidor sí puede limitar:** `POST /api/auth/login` aplica un límite de tasa por IP (cubo `login`: 30 por minuto; sin IP válida no se limita) **después** de `assertSameOrigin` y **antes** de leer el cuerpo; al exceder → **429** con `Retry-After`. Frena a quien pruebe tokens masivamente contra el servidor.
15. **Lo que limita Firebase:** adivinar contraseñas ocurre en el navegador contra Firebase Authentication, que aplica su propio bloqueo temporal por correo/IP y responde `auth/too-many-requests`. Ese bloqueo no es configurable en el plan Spark ni lo ve nuestro servidor. La pantalla `/login` traduce `auth/too-many-requests` a «Demasiados intentos. Espera unos minutos o recupera tu contraseña.» (con enlace a `/recuperar`) en lugar del genérico «No se pudo ingresar». El resto de errores de credenciales conservan el mensaje único «Credenciales inválidas» de F4.
16. `/login` añade los enlaces «¿Olvidaste tu contraseña?» (a `/recuperar`) y «Crear cuenta» (a `/registro`).
17. **Qué no se hace (por diseño):** no se cuentan intentos fallidos en nuestra base ni se bloquea una cuenta por ellos, porque el servidor no ve esos intentos y cualquier contador enviado por el navegador sería falsificable. Cambiarlo exigiría mover la verificación de contraseña al servidor (llamar a la API REST de Firebase desde el servidor), que reabre ADR-0003; ver pregunta 2.

### Comunes
18. Las tres pantallas son de servidor dentro de un `<Suspense>` solo si leen datos de la petición; como `/login` no lee la sesión hoy, `/registro` y `/recuperar` tampoco la leen (son formularios de cliente). Si en el futuro leen la sesión, aplican `await connection()` (S1, regla 1).
19. **Contenido de la CSP:** `identitytoolkit.googleapis.com` ya permite registrar, ingresar y enviar el correo de recuperación; no hace falta ampliar `connect-src`. Si se activa reCAPTCHA Enterprise en Firebase habría que ampliarla (ADR-0008).
20. Disposición de las pantallas como `/login`: una sola columna centrada de ancho máximo `max-w-sm`; 360, 768 y 1024 px sin desplazamiento horizontal, objetivos ≥ 44 px, foco visible, etiquetas en todos los campos, `autocomplete` correcto (`name`, `email`, `new-password`).

## Entradas y salidas
| Operación | Entrada | Salida |
| --- | --- | --- |
| `POST /api/auth/register` | `CreateMemberInput` | 201 `Member` · 400 (validación o rol no permitido) · 403 (origen) · 409 (correo repetido) · 429 |
| `/registro` | formulario | cuenta creada, sesión iniciada y `/` · mensajes de error |
| `/recuperar` | `ForgotPasswordInput` `{ email }` | mensaje único de «si está registrado…» · error de formato · error de límite |
| `POST /api/auth/login` | como F4 | además: 429 por límite de tasa |

## Autorización
Todo es público. Ninguna de estas operaciones requiere sesión ni la modifica; el rol de una cuenta autoregistrada sale siempre de la lista cerrada de roles seleccionables.

## Criterios de aceptación
- **Dado** un visitante, **cuando** envía `POST /api/auth/register` con `{ name, email, password }` sin rol, **entonces** 201 y la cuenta es `EXTERNO` y activa.
- **Dado** `role: "ESTUDIANTE"`, **entonces** la cuenta queda `ESTUDIANTE`; con `DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR`, `"estudiante"` o `""`, **entonces** 400 y no existe la cuenta ni la identidad.
- **Dado** un campo extra como `active: false` o `member_id` en el cuerpo, **entonces** se ignora y no cambia el resultado.
- **Dado** un correo ya registrado (también con otras mayúsculas o espacios alrededor), **entonces** 409 y no se crea una segunda cuenta.
- **Dado** una contraseña de 7 caracteres, **entonces** 400; de 8 y de 100, 201; de 101, 400.
- **Dado** un `POST` desde otro origen, **entonces** 403; **dado** 11 registros desde la misma IP en una hora, **entonces** el 11.º recibe 429 con `Retry-After`; otra IP no se ve afectada.
- **Dado** que guardar el documento falla, **entonces** la identidad se borra y el correo puede volver a usarse.
- **Dado** la pantalla `/registro` con contraseñas distintas, **cuando** pulsa «Crear cuenta», **entonces** ve «Las contraseñas no coinciden.» y no se llama al servidor.
- **Dado** un registro correcto, **entonces** el visitante termina en `/` con la barra mostrando su nombre y «Cerrar sesión».
- **Dado** un registro correcto pero un fallo del ingreso automático, **entonces** ve «Tu cuenta se creó. Ingresa con tu correo y contraseña.» con el enlace a `/login`.
- **Dado** `/recuperar` con un correo registrado y con uno que no lo está, **entonces** el mensaje mostrado es idéntico.
- **Dado** `auth/user-not-found` de Firebase, **entonces** se muestra el mensaje de éxito; con `auth/too-many-requests`, el mensaje de demasiados intentos; con un correo mal formado, el de formato sin llamar a Firebase.
- **Dado** una cuenta inactiva que restablece su contraseña, **entonces** al ingresar sigue viendo «Credenciales inválidas».
- **Dado** `auth/too-many-requests` al ingresar, **entonces** `/login` muestra «Demasiados intentos. Espera unos minutos o recupera tu contraseña.» con el enlace a `/recuperar`; con `auth/wrong-password` sigue mostrando «Credenciales inválidas».
- **Dado** 31 llamadas a `POST /api/auth/login` desde una IP en un minuto, **entonces** la 31.ª recibe 429.
- **Dado** cualquiera de las tres pantallas a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal y se puede usar solo con teclado.

## Bordes
- Registro: nombre de 1, 120 y 121 caracteres; nombre solo con espacios (→ 400); correo con mayúsculas y espacios; correo sin dominio; contraseña de 7, 8, 100 y 101; `role` ausente, `null`, `""`, `"EXTERNO"`, `"Estudiante"`; cuerpo vacío o que no es JSON; doble envío del formulario; dos registros simultáneos con el mismo correo (uno 201 y otro 409); registro con una sesión abierta.
- Recuperación: correo vacío, solo espacios, con mayúsculas, de 254 caracteres; envío repetido en seguida (`auth/too-many-requests`); sin red.
- Ingreso: 30 y 31 llamadas al servidor; IP ausente (no se limita); la cuenta autoregistrada y la de mostrador usan el mismo ingreso.

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `accounts/schema.ts` | orquestador | `ForgotPasswordInputSchema = z.object({ email: <correo recortado y en minúsculas> })` y su tipo |
| `shared/server/security/rate-limit.ts` | backend | `RATE_LIMITS.register = { limit: 10, windowMs: 3_600_000 }` y `RATE_LIMITS.login = { limit: 30, windowMs: 60_000 }`. **Ojo:** el barrido de claves vencidas asume la ventana menor; con una ventana de 1 h debe seguir siendo correcto (comprobar y probar) |
| `app/api/auth/register/route.ts` | backend | `POST` según las reglas 1–5 (`assertSameOrigin`, `enforceRateLimit("register", clientKey(req), new Date())`, `CreateMemberInputSchema.parse`, `getContainer().members.register`, 201, `handleError`) |
| `app/api/auth/login/route.ts` | backend | añade `enforceRateLimit("login", clientKey(req), new Date())` tras `assertSameOrigin` (regla 14) |
| `accounts/ui/auth-client.ts` | frontend | Ayudantes de cliente compartidos: `signInAndGetIdToken(email, password)`, `closeClientSession()`, `readErrorMessage(res, fallback)` (extraídos de `login-form.tsx`; se reutilizan en los tres formularios) |
| `accounts/ui/register-form.tsx` · `app/registro/page.tsx` | frontend | Reglas 6–7 y 20 |
| `accounts/ui/forgot-password-form.tsx` · `app/recuperar/page.tsx` | frontend | Reglas 9–11 y 20; función pura `messageForResetError<T>(error: T): string \| null` (null = éxito) para poder probarla sin Firebase |
| `accounts/ui/login-form.tsx` | frontend | Reglas 15–16 (`auth/too-many-requests`, enlaces); lo demás no cambia |
| Pruebas | tests | Ruta de registro (todos los criterios), límites de tasa, `ForgotPasswordInputSchema`, `messageForResetError`, mapeo de errores de Firebase al mensaje de `/login`, render inicial de los tres formularios con `renderToStaticMarkup`, y la prueba de proyecto que ya exige `connection()` no debe romperse |

Reparto sugerido: **backend** (rutas y límites; es pequeño) ∥ **frontend A** (auth-client, `/registro`) ∥ **frontend B** (`/recuperar`, `/login`) tras fijar `auth-client.ts` ∥ **tests** → `npm run check:full` → `security` → handoff.

## Fuera de alcance
Verificación de la propiedad del correo (ver pregunta 1), solicitud del rol `DOCENTE` (F11–F12), creación de bibliotecarios (F13), desactivar cuentas (F14), cambiar la contraseña con sesión abierta (F15), formularios del personal para crear cuentas (F36), mover la verificación de contraseña al servidor (pregunta 2), personalizar el correo de Firebase desde código.

## Preguntas abiertas (resueltas)
1. **Verificación del correo:** no se exige por ahora.
2. **F17:** se acepta el bloqueo de Firebase (reglas 14–17).
3. **Correo ya registrado:** se muestra «Ya existe una cuenta con ese correo.» (regla 2).
4. **Cuentas de mostrador (F36):** el formulario del personal **pide contraseña** (como hoy en F3) y la persona puede restablecerla con «¿Olvidaste tu contraseña?» (F16). No hay envío automático de enlace.

## Enmienda: aviso de la CSP por Zod en el navegador
Zod 4 comprueba al cargar si puede compilar código (`Function("")`) para su modo rápido; la CSP de producción lo bloquea (sin `'unsafe-eval'`), Zod lo captura y sigue, pero el navegador registra «blocked a JavaScript eval». Se resuelve **sin tocar la CSP**: un componente de cliente `app/shared/ui/client-setup.tsx` (fija `z.config({ jitless: true })` al cargar, no renderiza nada) montado en `app/layout.tsx`, de modo que ningún Zod del navegador intente compilar código. Regla de orden: ningún import del proyecto ni de `zod` puede evaluarse antes de `@/shared/ui/client-setup` (o de `./auth-client`, que lo importa primero) en los módulos que llega a ejecutar el navegador; los paquetes de terceros (`firebase/*`, `next/*`) sí pueden ir antes. Una prueba de proyecto lo vigila. Criterio: en producción, abrir `/login`, `/registro`, `/recuperar` y `/prestamos` no registra ninguna violación de `script-src`/eval en la consola. (Prueba: tras importar el módulo, `z.config().jitless === true`.)
