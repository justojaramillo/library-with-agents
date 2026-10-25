# F0 · Base del proyecto (capa compartida, entorno, sesión y datos de ejemplo)

- **Estado:** Aprobada
- **Rol(es):** todos (infraestructura)
- **Contrato afectado:** `app/shared/schema.ts` (ya fijado); no cambia contratos de features
- **Decisiones:** ADR-0001 (arquitectura), ADR-0003 (Firebase y Blob), ADR-0005 (convenciones), ADR-0007 (despliegue)

## Objetivo
Que exista todo lo que las features de negocio dan por hecho: errores de dominio y su traducción a HTTP, sesión por cookie de Firebase, protección contra CSRF, clientes de Firebase, validación del entorno, raíz de composición, datos de ejemplo y las puertas de calidad (`npm run check`). Sin esta base, ninguna de F1–F38 se puede implementar.

## Reglas de negocio
**Errores y HTTP** (`app/shared/server/errors.ts`, `http.ts`)
1. Existen `DomainError` y sus hijas `NotFoundError` (404), `ConflictError` (409), `UnauthorizedError` (401) y `ForbiddenError` (403). Cada una conserva su nombre de clase en `name`.
2. `handleError(error)` es la única traducción a HTTP: `ZodError` → 400 `{ error: "Datos inválidos", issues: [{ path, message }] }`; `SyntaxError` al leer el cuerpo → 400 `{ error: "JSON inválido" }`; error de dominio → su código con `{ error: mensaje }`; cualquier otro → 500 `{ error: "Error interno" }` y el detalle solo va al log. Los errores internos de Next (`redirect`, `notFound`, prerender) se vuelven a lanzar con `unstable_rethrow`.
3. Un `ZodError` o un error de entorno nunca revela nombres de variables ni valores.

**Origen de las peticiones (CSRF)** (`security/origin.ts`, `http.ts`)
4. `checkSameOrigin({ method, secFetchSite, origin, requestOrigin, contentType })`: si `Sec-Fetch-Site` está presente solo `same-origin` y `none` pasan; si falta, `Origin` debe ser igual al origen de la petición; si faltan ambas cabeceras solo pasan GET, HEAD y OPTIONS. `contentType: null` (sin cuerpo) pasa; `""` (cuerpo sin tipo) no. Con cuerpo, el único tipo válido es `application/json` (con o sin parámetros como `; charset=…`, sin distinguir mayúsculas); `application/json-patch+json`, `text/json`, `text/plain` y los formularios no. El tipo solo se evalúa si hay cuerpo, también en GET/HEAD.
5. `assertSameOrigin(req)` lanza `ForbiddenError("Origen no permitido")` y se llama al inicio de **todo** POST/PUT/PATCH/DELETE de `app/api/**`, antes de `requireStaff`.

**Sesión** (`security/session.ts`, `http.ts`)
6. La sesión es la cookie de sesión de Firebase. Nombre: `__Host-session` en producción y `session` en desarrollo (`sessionCookieName()`). Opciones (`sessionCookieOptions(maxAge)`): `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` solo en producción, sin `domain`, `maxAge` recibido. Duración: 8 horas (`SESSION_TTL_SECONDS`).
7. `createSessionResolver({ verifySessionCookie, loadMember })` devuelve `{ member_id, role }` solo si la cookie es válida, la cuenta existe y está activa; si no, `null`. El rol sale siempre del documento `members/{uid}`, nunca de la cookie ni del cliente.
8. `getSessionUser()` lee la cookie, verifica con `verifySessionCookie(cookie, true)` (con revocación) y devuelve `null` para los errores esperables de Firebase (`auth/id-token-expired`, `auth/id-token-revoked`, `auth/argument-error`, `auth/session-cookie-expired`, `auth/session-cookie-revoked`, `auth/user-disabled`, `auth/user-not-found`, `auth/invalid-id-token`, `auth/invalid-session-cookie`); cualquier otro error se registra (solo el código) y se relanza.
9. `requireUser()` lanza `UnauthorizedError("Inicia sesión")`; `requireStaff()` lanza `ForbiddenError("Solo para personal de la biblioteca")` si el rol no es `BIBLIOTECARIO` ni `ADMINISTRADOR`.
10. `POST /api/auth/logout` primero pasa `assertSameOrigin` (origen no permitido → 403, sin vaciar la cookie). Con origen permitido verifica la cookie, revoca los tokens de la cuenta (`revokeRefreshTokens`) y **siempre** responde `{ ok: true }` con la cookie vaciada (mismo nombre y opciones, `maxAge: 0`), aunque la verificación o la revocación fallen.

**Firebase y entorno** (`firebase.ts`, `env.ts`, `collections.ts`, `shared/ui/firebase-client.ts`)
11. `getAdminAuth()` y `getAdminDb()` inicializan `firebase-admin` una sola vez (también tras recarga en caliente) y **solo exigen las tres variables del servidor**: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` (las demás las valida `EnvChecker`, regla 13). Si faltan o están mal formadas lanzan `Error("Configuración de Firebase incompleta")` y registran solo el informe de `EnvChecker`.
12. `normalizePrivateKey` quita una pareja de comillas envolventes, recorta espacios y convierte `\n` literales en saltos de línea.
13. `EnvChecker(env)` valida: las siete variables de Firebase (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`); coherencia (mismo proyecto en servidor y navegador, la cuenta de servicio termina en `@<proyecto>.iam.gserviceaccount.com`, la clave es PEM, la API key empieza por `AIza`, el id de app web es `número:número:web:código`, el dominio termina en `.firebaseapp.com` o `.web.app`); `BLOB_READ_WRITE_TOKEN` es opcional y, si existe, empieza por `vercel_blob_rw_`. Su informe tiene una línea por variable (✓ / ✗ / pendiente) y **nunca** contiene valores. `npm run check:env` (`scripts/check-env.ts`) carga el archivo de entorno de la raíz con `process.loadEnvFile(".env")` dentro de un `try/catch` (si no existe, avisa y valida las variables ya definidas en el sistema, porque `tsx` no lo carga solo), imprime el informe y termina con código 1 si hay problemas. «Pendiente» es el estado de una variable opcional ausente (`BLOB_READ_WRITE_TOKEN`) y no cuenta como problema.
14. `COLLECTIONS = { members, books, loans, meta }` (módulo sin `server-only`, para poder importarlo en pruebas). `getClientAuth()` (navegador) inicializa la app web una vez con las cuatro `NEXT_PUBLIC_FIREBASE_*`.
15. `firestore.rules` niega toda lectura y escritura directa del cliente; la app accede a Firestore solo con el SDK de administración.

**Composición**
16. *(Se construye al cerrar el paso 3 de `docs/bootstrap.md`, cuando ya existen los servicios de F1–F4.)* `app/features/container.ts` (`import "server-only"`) es el único lugar que conecta las features: construye una vez (guardado en `globalThis`) los repositorios de Firestore, la identidad de Firebase y los servicios. Se obtiene con `getContainer()` (no con constantes sueltas) y expone `members` (`register`, `get`, `list`; sin `provision`), `admin` (con `provision`, solo para el seed y F13), `auth` y `books`. `loans` se añade con F5 (hasta entonces no existe).

**Datos de ejemplo** (`scripts/seed.ts`)
17. *(Igual que la regla 16: se construye al cerrar el paso 3.)* `npm run seed -- --yes` crea cinco cuentas —«Ada Administradora» `admin@example.com` (ADMINISTRADOR), «Beatriz Bibliotecaria» `bibliotecaria@example.com` (BIBLIOTECARIO), «Diego Docente» `docente@example.com` (DOCENTE), «Samuel Estudiante» `samuel@example.com` (ESTUDIANTE), «Sara Externa» `sara@example.com` (EXTERNO)— y cinco libros: 9780307474728 *Cien años de soledad* (Gabriel García Márquez, 2 ejemplares), 9780060883287 *El amor en los tiempos del cólera* (Gabriel García Márquez, 1), 9788437604947 *Rayuela* (Julio Cortázar, 1), 9780141182803 *Ficciones* (Jorge Luis Borges, 3) y 9780140449136 *Crimen y castigo* (Fiódor Dostoievski, 1). Sin `--yes` solo imprime el proyecto de destino y termina sin escribir. No borra nada: lo que ya existe se omite con un aviso. Cada cuenta nueva recibe una contraseña aleatoria (`randomBytes(18)` en base64url) que se imprime **una sola vez**; no hay contraseñas fijas en el repositorio. Lo ejecuta la persona, nunca los agentes.

**Puertas de calidad**
18. `npm run check` = formato (Biome) + lint (ESLint con las reglas de `AGENTS.md` y las fronteras de ADR-0001) + tipos + pruebas (Vitest). `npm run check:full` añade `npm run build`.
19. Código con `import "server-only"` no se importa en pruebas: solo `firebase.ts` y `container.ts` lo llevan; toda la lógica que se prueba (errores, origen, sesión, entorno, `COLLECTIONS`, códigos de error de Firebase) vive en módulos sin `server-only`.
20. `tests/project/` contiene las pruebas del proyecto: `guard` (zonas prohibidas), `agents-consistency` (los agentes de `.claude/` y `.opencode/` coinciden), `contracts-style` (`snake_case` en los esquemas) y `palette-contrast` (contraste de la paleta, WCAG 2.1 AA). `tests/helpers/factories.ts` construye datos válidos por defecto y, al cerrar el paso 3, el «mundo» en memoria (`makeWorld`).

## Interfaz de módulos (firmas que fijan el trabajo en paralelo de backend, frontend y pruebas)
| Módulo | Exporta |
| --- | --- |
| `app/shared/server/errors.ts` | `DomainError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError` (`constructor(message: string)`; `name` = nombre de la clase) |
| `app/shared/server/security/origin.ts` | `type SameOriginInput = { method; secFetchSite: string \| null; origin: string \| null; requestOrigin: string; contentType: string \| null }`; `checkSameOrigin(input): boolean` |
| `app/shared/server/security/session.ts` | `sessionCookieName(): string`; `sessionCookieOptions(maxAgeSeconds: number)`; `SESSION_TTL_SECONDS` (28800); `type SessionResolverDeps = { verifySessionCookie(cookie: string): Promise<{ uid: string } \| null>; loadMember(uid: string): Promise<{ role: Role; active: boolean } \| undefined> }`; `createSessionResolver(deps): (cookie: string \| undefined) => Promise<SessionUser \| null>` |
| `app/shared/server/security/firebase-errors.ts` | `firebaseErrorCode<T>(error: T): string \| undefined`; `isExpectedAuthError<T>(error: T): boolean`; `describeAuthError<T>(error: T): string` (solo código o nombre, nunca el mensaje) |
| `app/shared/server/env.ts` | `EnvSchema`; `normalizePrivateKey(raw: string): string`; `class EnvChecker` con `constructor(env)`, `problems(): { name; message }[]`, `report(): string` e `isValid(): boolean` |
| `app/shared/server/collections.ts` | `COLLECTIONS = { members: "members", books: "books", loans: "loans", meta: "meta" }` (`as const`) |
| `app/shared/server/firebase.ts` | `import "server-only"`; `getAdminAuth(): Auth`, `getAdminDb(): Firestore`, reexporta `COLLECTIONS` |
| `app/shared/server/http.ts` | `import "server-only"`; `handleError<T>(error: T): NextResponse`; `assertSameOrigin(req: Request): void`; `getSessionUser(): Promise<SessionUser \| null>`; `requireUser()`; `requireStaff()`; `revokeSessionCookie(cookie): Promise<void>` (nunca lanza) |
| `app/shared/ui/firebase-client.ts` | `getClientAuth(): Auth` |
| `app/api/auth/logout/route.ts` | `POST` |
| `app/features/container.ts` | `import "server-only"`; `getContainer()` → `{ members, admin, auth, books }` (ver regla 16) |
| `scripts/check-env.ts` | imprime `new EnvChecker(process.env).report()` y «Entorno válido» o el aviso de variables por corregir |

## Entradas y salidas
| Pieza | Entrada | Salida / error |
| --- | --- | --- |
| `handleError` | cualquier error | `NextResponse` JSON con el código de la regla 2 |
| `assertSameOrigin` | `Request` | nada · `ForbiddenError("Origen no permitido")` |
| `getSessionUser` | cookie de la petición | `{ member_id, role }` · `null` |
| `requireUser` / `requireStaff` | — | `{ member_id, role }` · 401 / 403 |
| `POST /api/auth/logout` | cookie | 200 `{ ok: true }` siempre |
| `EnvChecker.report()` | `process.env` | texto, una línea por variable, sin valores |

## Autorización
La base no define permisos de negocio; solo provee `requireUser` y `requireStaff`. La identidad sale siempre de la sesión.

## Criterios de aceptación
- **Dado** un `ZodError`, **cuando** pasa por `handleError`, **entonces** 400 con `issues` y sin valores del entorno.
- **Dado** un POST con `Sec-Fetch-Site: cross-site` o con `Content-Type: text/plain`, **cuando** llega a una ruta, **entonces** 403.
- **Dado** una cookie ausente, alterada, expirada o de una cuenta inactiva, **cuando** se resuelve la sesión, **entonces** `null`; con una válida devuelve el rol actual de Firestore aunque haya cambiado desde el ingreso.
- **Dado** `NODE_ENV=production`, **entonces** la cookie se llama `__Host-session` y es `secure`.
- **Dado** una clave privada entre comillas dobles y con `\n` literales, **cuando** se normaliza, **entonces** es una clave PEM válida.
- **Dado** un entorno completo, **cuando** corre `npm run check:env`, **entonces** "Entorno válido" y código 0; si falta una variable, la línea de esa variable dice ✗ y ningún valor aparece en la salida.
- **Dado** `npm run seed` sin `--yes`, **entonces** no se escribe nada en Firebase.
- **Dado** un `seed` ejecutado dos veces, **entonces** la segunda no falla, no duplica nada y avisa de lo omitido.
- **Dado** el servidor de producción iniciado con `--no-experimental-require-module`, **cuando** se pide `/api/books`, **entonces** 200 (ADR-0007).
- **Dado** el proyecto recién construido, **entonces** `npm run check:full` pasa.

## Bordes
Cookie vacía · cookie con espacios · `Origin` con otro puerto o esquema · `Content-Type` en mayúsculas o con `charset` · cuerpo sin `Content-Type` · variable de entorno vacía · clave con comillas simples · cuenta con rol inválido en Firestore.

## Fuera de alcance
Las reglas de negocio de cada feature, la barra de navegación y las pantallas (F33), el limitador de intentos de ingreso (F17), la recuperación de contraseña (F16), Vercel Blob (F27) y las pruebas contra Firebase real.

## Preguntas abiertas
Ninguna.
