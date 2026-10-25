## Entrega: orquestador · S1 (endurecimiento de seguridad)
**Hecho:**
- **Error de prerender (`blocking-prerender-current-time`):** `await connection()` antes de leer la sesión en `session-nav`, `/cuentas`, `/prestamos`, `/mis-prestamos` y `/mis-vencidos`; y en `CatalogContent` de `/` (`blocking-prerender-random`). Una prueba de proyecto (`tests/project/session-connection.test.ts`) falla si algo lee la sesión sin `connection()`. Confirmado por la persona en el navegador.
- **Contenedor en desarrollo:** se reconstruye si cambia la versión del módulo (antes, `next dev` conservaba servicios viejos tras un cambio).
- **Registro de errores:** los 500 registran nombre, código y mensaje recortado (nunca el objeto completo); un documento corrupto de préstamos, cuentas o libros da 500 «Error interno», no 400.
- **Cabeceras y CSP** en `next.config.ts` (CSP solo en producción); `connect-src` con `identitytoolkit` y `securetoken`.
- **Límite de tasa en memoria** (`GET /api/books` 60/min por IP, búsqueda de personas 30/min por miembro; 429 con `Retry-After`); clave por IP válida (IPv6 en /64), sin IP no se limita, `Map` con tope de 10 000.
- **Caché del catálogo** (`use cache`, 60 s / 120 s, etiqueta `books`), con invalidación al crear libros, prestar y devolver; la clave de caché se normaliza; si la invalidación falla, la respuesta no cambia.
- **Cuentas paginadas** (`GET /api/members` → `MemberPage`; `/cuentas` con «Siguiente»), aviso de búsqueda truncada (`X-Search-Truncated`).
- **Scripts:** `npm run reconcile:identities` (borrado solo con `--yes --delete --project=<id>`, aborta con entorno mezclado, se niega con ≥50 % huérfanas salvo `--force-many`, relee antes de borrar y respeta 10 min de antigüedad); `backfill:members` con `--limit=N`.
- **Ingreso con Firebase** sin ventanas emergentes (`initializeAuth` con `inMemoryPersistence`). `IdSchema` rechaza `.`, `..` y los ids de la forma `__x__`.

**Archivos:** `app/shared/server/{errors,http}.ts`, `app/shared/server/security/{rate-limit,orphan-policy}.ts`, `next.config.ts`, `app/features/container.ts`, `app/features/catalog/server/{book-search-cache,book-search,repository.firestore}.ts`, `app/features/accounts/server/*` (paginación, búsqueda, `error-log.ts`), `app/api/{books,loans,members}/**`, `app/cuentas/page.tsx`, `app/features/accounts/ui/account-pagination.tsx`, `app/features/loans/ui/search-picker.tsx`, `app/shared/ui/firebase-client.ts`, `scripts/{reconcile-identities,backfill-member-search}.ts`, `app/shared/schema.ts`, `app/features/accounts/schema.ts`; pruebas en `app/features/*/tests`, `app/shared/tests`, `tests/project`.

**Cómo verificar:** `npm run check:full` → 1246 pruebas en verde y build correcto. `npm run check:env` → entorno válido (incluye `BLOB_READ_WRITE_TOKEN`).

**Decisiones:** ADR-0008 (límite en memoria, caché del catálogo, cabeceras). El límite en memoria es por instancia: frena un script desbocado, no es un tope global.

**Pendiente / bloqueos:**
- **La persona debe probar tras desplegar:** el ingreso con la CSP activa (móvil y Safari), y medir la caché (dos búsquedas iguales → ¿una sola lectura de Firestore?). Si la caché no funciona en serverless, valorar `use cache: remote` en un ADR.
- Si el proyecto activa reCAPTCHA Enterprise para correo y contraseña, hay que añadir sus dominios a la CSP.
- Fuera de alcance: límite global de tasa, intentos de ingreso (F17), enlace de restablecimiento para cuentas de mostrador (decisión de producto, Ola 2), prueba de atomicidad con el emulador, paginar `/prestamos`.
- Vercel Blob quedó documentado como conectado (ADR-0003 y ADR-0007).

**Dudas de la especificación (sin decidir):** orden de la paginación por código de carácter (distinto del orden en español de la búsqueda); cabecera `x-vercel-forwarded-for` presente pero no válida con `x-forwarded-for` válida (hoy da «desconocida»); host de emulador definido pero vacío (hoy cuenta como no definido).
