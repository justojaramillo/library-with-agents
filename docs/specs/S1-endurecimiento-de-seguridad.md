# S1 · Endurecimiento de seguridad (pendientes de los informes de `security`)

- **Estado:** Aprobada (por instrucción de la persona: «a corregir los pendientes de seguridad»)
- **Rol(es):** sistema
- **Contrato afectado:** `app/features/accounts/schema.ts` (`ListMembersQuerySchema`, `MemberPageSchema`); `GET /api/members` sin `q` cambia de `Member[]` a `MemberPage` (enmienda a F3).
- **Decisiones:** `docs/adr/0008-limite-de-tasa-y-cache-del-catalogo.md`.

## Objetivo
Cerrar los pendientes de seguridad y de costo que dejaron las revisiones de F0–F35, sin cambiar lo que ve el usuario salvo lo indicado.

## Reglas de negocio
1. **Sesión y prerender (error `blocking-prerender-current-time`).** Todo componente de servidor que lee la sesión (`getSessionUser` / `readNavUser`) llama a `await connection()` (`next/server`) **antes** de leerla: `app/session-nav.tsx`, `app/cuentas/page.tsx`, `app/prestamos/page.tsx`, `app/mis-prestamos/page.tsx`, `app/mis-vencidos/page.tsx`. El `catch` que envuelva esas lecturas sigue llamando primero a `unstable_rethrow`. Una prueba de proyecto falla si un archivo `.tsx` de `app/` usa `getSessionUser`/`readNavUser` sin `connection`. (Enmienda a F33, regla 6.)
2. **Registro de errores 500.** `handleError` no registra el objeto de error completo: registra solo el nombre, el `code` si es texto y el mensaje recortado a 200 caracteres, sin pila ni propiedades; la respuesta sigue siendo «Error interno». **Excepción (F11–F12):** si el mensaje contiene «requires an index» (Firestore sin un índice compuesto), se añade además el primer enlace `https://console.firebase.google.com/…` completo (tope de 2000 caracteres), porque sin él no se ve qué índice crear; el enlace solo lleva el proyecto y la definición del índice.
3. **Cabeceras de seguridad** según ADR-0008 en todas las rutas, solo en producción para la CSP (el modo desarrollo de Next necesita `eval`).
4. **Límite de tasa** según ADR-0008: `TooManyRequestsError` (429, `Retry-After` en segundos) en `app/shared/server/errors.ts`; `enforceRateLimit(bucket, key, now)` en `app/shared/server/security/rate-limit.ts` con `RATE_LIMITS = { catalogSearch: { limit: 60, windowMs: 60_000 }, memberSearch: { limit: 30, windowMs: 60_000 } }`. Ventana fija; la petición número `limit` pasa y la `limit + 1` recibe 429; un `Map` que descarta claves vencidas para no crecer sin fin; el tiempo se inyecta (`now: Date`).
5. **Caché del catálogo** según ADR-0008: `books.search(q, limit?)` del contenedor devuelve resultados cacheados 60 s (clave: `q` y `limit`); `POST /api/books`, `POST /api/loans` y `POST /api/loans/:id/return` invalidan la etiqueta `books` tras terminar bien. Sin la caché el comportamiento de F2 es idéntico.
6. **Paginar cuentas.** `GET /api/members` sin `q` acepta `limit` (1–100, por defecto 50) y `after` y responde `MemberPage`: cuentas ordenadas por nombre y luego por id; `next_after` es el id de la última cuenta si hay más, o `null`. La pantalla `/cuentas` muestra una página de 50 con un enlace «Siguiente» (`?after=`) y «Volver al inicio» cuando hay cursor; sigue siendo solo para personal. `MemberService.list(query)` y `MemberRepository.list(limit, after)` lo implementan (se lee `limit + 1` documentos).
7. **Búsqueda de personas truncada.** `MemberRepository.search` devuelve `{ members, truncated }`; `truncated` es `true` si se leyeron los 200 documentos del tope. La ruta responde la lista como hasta ahora y añade la cabecera `X-Search-Truncated: 1` cuando `truncated`; el buscador de `/prestamos` muestra «Puede haber más coincidencias: escribe más para afinar.» (`role="status"`). (Enmienda a F34, B4.)
8. **Identidades huérfanas.** Script `npm run reconcile:identities`: lista las cuentas de Firebase Authentication que no tienen documento `members/{uid}` (nombre del proveedor y fecha de creación, correo enmascarado «ab***@dominio»). Con `--yes --delete` las borra; sin `--yes` no escribe nada; imprime el proyecto y, con `--yes`, espera 5 s («Ctrl+C para cancelar»). No toca cuentas con documento.
9. **Documento de préstamo corrupto.** `toLoan` (Firestore) convierte un `ZodError` de lectura en un error interno: la API responde 500 «Error interno» (no 400) y el detalle solo va al log según la regla 2.
11. **Script `reconcile-identities` más seguro** (revisión de seguridad H1–H2). Además de lo de la regla 8: imprime `FIREBASE_AUTH_EMULATOR_HOST` y `FIRESTORE_EMULATOR_HOST`; **aborta** si uno está definido y el otro no (Auth real con Firestore del emulador, o al revés); con `--delete` exige `--project=<id>` igual a `FIREBASE_PROJECT_ID`; **se niega** a borrar si las huérfanas son la mitad o más de todas las identidades, salvo `--force-many`; antes de cada `deleteUser` vuelve a leer `members/{uid}` y salta la identidad si ya existe o si se creó hace menos de 10 minutos. La decisión de qué borrar es una función pura probada en `scripts/` o en `app/shared/server`.
12. **Límite de tasa más robusto** (H3–H4). La clave de cliente sale de `x-vercel-forwarded-for` y, si falta, de la primera IP de `x-forwarded-for`; debe ser una IP válida (`node:net` `isIP`) de máximo 64 caracteres, y las IPv6 se reducen a su prefijo /64; si no hay IP válida la clave es «desconocida» y **no se limita** (no hay un cubo compartido para anónimos). El `Map` tiene un tope de 10 000 entradas (al llegar, se barren las vencidas y, si sigue lleno, se expulsa la más antigua) y el barrido de vencidas ocurre como máximo una vez por ventana.
13. **Clave de caché normalizada** (H5). `books.search` recorta `q`, la pasa a minúsculas, colapsa espacios y normaliza `limit` antes de llamar a la función cacheada; el resultado es el mismo que sin normalizar (la búsqueda ya no distingue mayúsculas).
14. **La invalidación de la caché no cambia la respuesta** (H9): `invalidateBooksCache()` se llama dentro de su propio `try/catch` que registra solo el nombre del error; un fallo no convierte en 500 un préstamo, devolución o alta ya guardados.
15. **Registro de errores** (H10): `member-service.ts` y `scripts/backfill-member-search.ts` registran con la misma descripción recortada de la regla 2, no el objeto completo.
16. **Documentos corruptos de cuentas y libros** (H11): como en la regla 9, `toRecord` de `members` y de `books` convierte el `ZodError` de lectura en un error interno (500 «Error interno»); `/cuentas` distingue un cursor inexistente de un documento dañado (este último se propaga a `app/error.tsx`).
17. **Ids reservados de Firestore** (H12): `IdSchema` rechaza `.`, `..` y los de la forma `__x__`.
18. **Ingreso con Firebase bajo la CSP** (H7–H8): el cliente usa `initializeAuth(app, { persistence: inMemoryPersistence })` sin resolutor de ventanas emergentes (la sesión de la app es la cookie del servidor; el SDK de cliente solo sirve para obtener el `id_token`), de modo que no carga `apis.google.com` ni el iframe `__/auth`. Se quita `https://www.googleapis.com` de `connect-src`, que queda con `identitytoolkit.googleapis.com` y `securetoken.googleapis.com`.
10. **Defensa en profundidad.** Comentario en `container.ts`: `members.search`, `members.getMany` y `members.list` no comprueban al actor; toda ruta o página que los use debe exigir personal antes.

## Entradas y salidas
| Pieza | Entrada | Salida |
| --- | --- | --- |
| `GET /api/members` (sin `q`) | `limit`, `after` opcionales | 200 `MemberPage` · 400 · 401 · 403 · 429 |
| `GET /api/members?q=` | como F34 | 200 `Member[]` (+ `X-Search-Truncated`) · 400 · 401 · 403 · 429 |
| `GET /api/books` | como F2 | 200 `Book[]` · 400 · 429 |

## Autorización
Sin cambios: las cuentas y la búsqueda de personas son solo para personal; el catálogo es público. El límite de tasa aplica antes que la validación de parámetros y después de la autorización donde hay sesión.

## Criterios de aceptación
- **Dado** `next dev`, **cuando** se precarga un enlace y se abre cualquier página con sesión, **entonces** no aparece `blocking-prerender-current-time` en el log.
- **Dado** un archivo `.tsx` de `app/` que usa `getSessionUser` sin `connection`, **entonces** `npm test` falla.
- **Dado** un error 500 con un objeto de error con muchas propiedades, **entonces** el log recibe solo nombre, código y mensaje recortado.
- **Dado** 60 peticiones a `GET /api/books` desde una IP en un minuto, **entonces** la 61 recibe 429 con `Retry-After`; **y** pasado el minuto vuelve a responder 200.
- **Dado** el personal que hace 31 búsquedas de personas en un minuto, **entonces** la 31 recibe 429; otro miembro del personal no se ve afectado.
- **Dado** `GET /api/books?q=x` dos veces seguidas, **entonces** Firestore se lee una sola vez; **y** tras `POST /api/books` la siguiente búsqueda vuelve a leer.
- **Dado** 120 cuentas, **cuando** el personal abre `/cuentas`, **entonces** ve 50, un enlace «Siguiente», y tras recorrerlas ve las 120 sin repetir ninguna; la última página no tiene «Siguiente».
- **Dado** una búsqueda de personas que lee 200 documentos, **entonces** la respuesta lleva `X-Search-Truncated: 1` y el buscador avisa; con menos, no.
- **Dado** una identidad de Authentication sin cuenta, **cuando** se ejecuta `npm run reconcile:identities`, **entonces** aparece en el informe con el correo enmascarado y no se borra sin `--yes --delete`.
- **Dado** un documento de préstamo con un campo inválido, **cuando** se consulta, **entonces** 500 «Error interno» y no 400.

## Bordes
`limit` 1, 100 y 101 · `after` inexistente (→ 400) · última página exacta (sin `Siguiente`) · cuentas con el mismo nombre (desempata por id) · límite de tasa en el segundo exacto de cambio de ventana · IP ausente (clave «desconocida») · `q` repetido para cachear (máx. 100 caracteres) · CSP: `login` sigue funcionando.

## Interfaz de módulos
| Pieza | Responsable |
| --- | --- |
| `app/shared/server/errors.ts` (`TooManyRequestsError`), `http.ts` (`handleError`: 429 + `Retry-After`, registro recortado), `security/rate-limit.ts`, `next.config.ts` (cabeceras), `loans/server/repository.firestore.ts` (`toLoan`) | **backend 1** |
| Caché de `books.search` en `catalog/server/` + `container.ts`, `api/books/route.ts` (límite `catalogSearch`), invalidación en `api/books`, `api/loans` y `api/loans/[id]/return` | **backend 2** |
| `accounts/server/*` (`list(query)`, `search` con `truncated`), `api/members/route.ts` (paginar, `X-Search-Truncated`, límite `memberSearch`), `scripts/reconcile-identities.ts` + script `reconcile:identities`, comentario de `container.ts` | **backend 3** |
| `connection()` en las cinco piezas de la regla 1 y comentario | **frontend 1** |
| `/cuentas` paginada y aviso del buscador | **frontend 2** (cuando backend 3 termine) |
| Pruebas | **tests** |

## Criterios de aceptación de las reglas 11–18
- **Dado** `FIRESTORE_EMULATOR_HOST` definido y Authentication real, **cuando** se ejecuta `reconcile-identities` con `--yes --delete`, **entonces** aborta sin borrar nada.
- **Dado** que todas las identidades salen como huérfanas, **entonces** se niega a borrar sin `--force-many`; **y** sin `--project=<id>` correcto, tampoco borra.
- **Dado** una identidad huérfana creada hace 2 minutos, o que obtuvo documento mientras tanto, **entonces** no se borra.
- **Dado** `x-forwarded-for` con 8000 caracteres o un valor que no es una IP, **entonces** la clave es «desconocida» y no se limita; **dado** una IPv6, **entonces** dos direcciones del mismo /64 comparten contador; **dado** 20 000 claves distintas, **entonces** el `Map` nunca supera 10 000 entradas.
- **Dado** `Dune`, `dune` y ` DUNE `, **entonces** la búsqueda del contenedor pide la caché con la misma clave (`dune`).
- **Dado** que `revalidateTag` lanza, **entonces** `POST /api/loans` sigue respondiendo 201.
- **Dado** un documento corrupto de `members` o `books`, **entonces** 500 «Error interno», no 400.
- **Dado** `IdSchema.parse(".")`, `".."` o `"__x__"`, **entonces** falla; `"abc"` y `"_a_"` pasan.

## Fuera de alcance (necesitan una decisión tuya o un servicio que no hay)
- Límite global de tasa (necesita un almacén compartido) y límite de intentos de ingreso (F17).
- Enviar enlace de restablecimiento a las cuentas de mostrador en vez de contraseña elegida por el personal (decisión de producto, Ola 2 con F16).
- Reserva remota de ejemplares por el propio prestatario (revisar en la Ola 2).
- Prueba de atomicidad contra el emulador de Firestore (no hay emulador en el entorno).
- Ventana de milisegundos entre comprobar cuenta/libro y crear el préstamo (documentada, riesgo bajo).
- Recalcular `search_keys` al editar nombre o correo (cuando exista esa función).
- Paginar `/prestamos`.

## Preguntas abiertas
Ninguna.
