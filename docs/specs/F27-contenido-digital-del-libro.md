# F27 · Cargar el contenido digital de un libro y fijar sus copias digitales

- **Estado:** Aprobada (la persona aceptó la propuesta de las siete preguntas y aprobó, 2026-10-25)
- **Rol(es):** personal (`BIBLIOTECARIO`, `ADMINISTRADOR`)
- **Contrato afectado:** nuevo `app/features/reader/schema.ts` (`DIGITAL_RULES`, `SetDigitalCopiesInputSchema`, `UploadContentInputSchema`, `DigitalInfoSchema`) y su registro en `app/features/container.ts`. `app/shared/schema.ts` y el contrato de `catalog` **no cambian** (los campos digitales los guarda y lee el lector; el catálogo los ignora, ver «Qué hay hoy»). Dependencia nueva: `@vercel/blob` ≥ 2.3, **ya justificada en ADR-0003** (regla 6 de `AGENTS.md`); no hace falta ADR nuevo.
- **Depende de:** `docs/specs/F1-registrar-libro.md`, `docs/specs/F36-formularios-de-libros-y-cuentas.md` (patrón de formulario) y `docs/adr/0003-firebase-plataforma.md` (diseño de Vercel Blob privado). Es la base de F28–F32 y F38.
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA, Cache Components).

## Objetivo
El personal sube el texto de un libro (un archivo Markdown) y fija cuántas copias digitales se pueden prestar a la vez, para que después se puedan pedir prestadas (F38) y leer en el navegador (F28).

## Qué hay hoy y qué cambia
- El store de **Vercel Blob privado ya está creado y conectado** (`npm run check:env` valida `BLOB_READ_WRITE_TOKEN`). En código todavía no se usa: `@vercel/blob` no está instalado y no existe `app/features/reader/`.
- Un libro (`books/{id}`) tiene `isbn`, `title`, `author` y `copies` (ejemplares físicos). `toRecord` del catálogo valida con `CreateBookInputSchema` (objeto de Zod, que **descarta los campos desconocidos**): por eso se pueden añadir campos digitales al mismo documento sin romper el catálogo.
- Campos nuevos del documento `books/{id}`, **propiedad del lector**: `digital_copies` (entero 0–100; **si falta, vale 0**: los libros existentes no cambian), `content_path` (ruta exacta en Blob o ausente), `content_bytes` y `content_updated_at` (ISO). Ninguno sale en `Book` ni en la búsqueda pública (F2), y **la ruta nunca sale al exterior**.
- Los libros del `seed` no llevan contenido digital.

## Reglas de negocio

### Copias digitales
1. **`PATCH /api/books/:id/digital/copies`** (personal) recibe `{ digital_copies }`: entero de **0 a 100** (`DIGITAL_RULES.maxCopies`). Es independiente de `copies` (físicos): un libro puede tener 3 físicos y 5 digitales. Respuesta **200** con el `DigitalInfo` actualizado.
2. **Bajar las copias:** no se permite dejar `digital_copies` por debajo de los préstamos digitales activos de ese libro → **409** «No puedes dejar menos copias digitales que préstamos digitales activos ({N}).». Hasta que exista F38 el contador de activos vale 0 (se conecta en el contenedor con un puerto `ActiveDigitalLoansReader`; F38 lo cambia por el real).
3. Se puede fijar `digital_copies > 0` sin contenido cargado (sirve para preparar el libro); mientras no haya contenido, F38 rechazará los préstamos digitales (`docs/features.md`). `digital_copies = 0` retira el libro del préstamo digital sin borrar el contenido.

### Contenido
4. **`PUT /api/books/:id/digital/content`** (personal) recibe `{ markdown }`: el texto completo del libro. Reglas: tras `trim()` no puede quedar vacío; **máximo 2 000 000 de bytes en UTF-8** (`DIGITAL_RULES.maxMarkdownBytes`, por debajo del límite de 4,5 MB del cuerpo de una función de Vercel); no puede contener el carácter nulo (`\u0000`). Más grande o vacío → **400**. Respuesta **200** con el `DigitalInfo`. No hay límite de páginas ni de líneas aquí (la división en páginas es de F28).
5. **Guardado en Blob** (ADR-0003): se sube a `books/{id}/content-{sufijo aleatorio}.md` en el store **privado** (`access: "private"`, tipo `text/markdown; charset=utf-8`); el servicio lo hace a través del puerto `ContentStore` (`put`, `get`, `remove`), nunca con el SDK directo. El contenido **nunca se sirve por URL** y esta feature **no tiene ninguna ruta que lo devuelva** (lo leerá F28).
6. **Reemplazar** (el libro ya tenía contenido): se escribe primero el archivo **nuevo**; después se actualiza el libro (`content_path`, `content_bytes`, `content_updated_at`) en una **transacción que comprueba que la ruta anterior no cambió**; si otra subida se adelantó → **409** «Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.» y se borra el archivo nuevo; si la actualización falla por otra causa, se borra el archivo nuevo (ADR-0003); si todo sale bien, se **borra el archivo anterior**. Si ese último borrado falla, la subida **no falla**: se registra un aviso y queda un archivo huérfano (pregunta 6). **Fallo ambiguo** (revisión de `security`): si `replaceContent` falla con un error que no es `ConflictError` ni `NotFoundError`, antes de borrar el archivo nuevo se vuelve a leer el libro; si ya apunta al archivo nuevo (la transacción sí se confirmó, p. ej. se perdió la respuesta), **no se borra** y la subida responde 200 (el archivo anterior queda huérfano y se registra un aviso); si no apunta a él, se borra como siempre y se propaga el error original.
7. **Contenido y préstamos activos:** reemplazar el contenido mientras hay lectores con préstamo digital activo está permitido (pregunta 3): en su siguiente página reciben la versión nueva.
8. **Lo que NO se hace aquí:** quitar el contenido de un libro (pregunta 4; para retirarlo del préstamo digital se pone `digital_copies = 0`), previsualizar el texto, convertir EPUB u otros formatos, sanear el Markdown (se guarda **tal cual**; el saneado ocurre al mostrarlo, F28: «texto saneado, sin HTML crudo»).

### Consulta
9. **`GET /api/books/:id/digital`** (personal) devuelve el `DigitalInfo`: `{ book_id, title, digital_copies, has_content, content_bytes, content_updated_at }` (`has_content = false` y los otros dos en `null` si no hay contenido). Nunca devuelve el texto ni la ruta.

### Autorización, orden y protección
10. **Solo personal.** Orden de comprobaciones: `assertSameOrigin` (en `PUT` y `PATCH`) → sesión (401) → rol de personal (403, **antes** de leer el cuerpo) → límite de tasa (solo en `PUT`, cubo `contentUpload`: **20 por hora por cuenta de personal**, 429 con `Retry-After`) → validación del `:id` y del cuerpo (400) → libro inexistente (**404** «El libro no existe.») → regla de negocio (409). Un prestatario recibe 403 aunque el `:id` o el cuerpo sean inválidos.
11. La identidad sale de la sesión. El cuerpo del `PUT` se lee con un tope de **4 200 000 bytes** (por debajo de los 4,5 MB de Vercel; el JSON escapa comillas y saltos de línea, así que el cuerpo puede pesar más que el texto) para no procesar cuerpos enormes: es solo una defensa; el límite del texto sigue siendo el de la regla 4, que comprueba el servicio en bytes UTF-8 sobre el `markdown` ya leído; un cuerpo que supera el tope → 400; un cuerpo que no es JSON → 400.
12. **Registro (log):** nunca se escribe el contenido, ni la ruta de Blob, ni el token; solo el id del libro y los tamaños.

### Pantalla
13. **`/libros/digital`** (personal; sin sesión → `/login`; prestatario → «Solo para el personal de la biblioteca.»; `<h1>` «Contenido digital»). Dos pasos en la misma página:
    - **Elegir el libro:** un campo «Buscar libro (título o autor)» con «Buscar» (reutiliza `GET /api/books?q=&limit=11` y el patrón de sugerencias de `/prestamos`); mínimo 2 caracteres; hasta 10 sugerencias («Título — Autor»); al elegir queda «Libro seleccionado: Título — Autor» con «Cambiar».
    - **Panel del libro seleccionado** (lee `GET /api/books/:id/digital`): estado actual («Copias digitales: N», «Contenido: cargado (X KB, el {fecha})» o «Contenido: sin cargar»); un formulario «Copias digitales» (número 0–100) con «Guardar copias»; y un formulario «Contenido» con un campo de archivo (`.md`, `.markdown`, `.txt`) y «Subir contenido». El archivo se lee en el navegador (`File.text()`), se muestra su nombre y tamaño, y se valida el tamaño y que no esté vacío **antes** de enviar. Reemplazar pide una confirmación en dos pasos («Reemplazar contenido» → «Confirmar reemplazo» + «Cancelar») cuando ya hay contenido.
14. Mensajes: éxito en `role="status"` («Se guardaron N copias digitales de «Título».» / «Se cargó el contenido de «Título» (X KB).»), errores en `role="alert"` con `aria-describedby`: el del servidor (409 con su texto), «El archivo está vacío.», «El archivo supera los 2 MB.», 429 → «Demasiadas cargas. Inténtalo más tarde.», 401/403 → «Tu sesión terminó. Vuelve a ingresar.», red → «No se pudo completar la acción». Sin doble envío; los botones se deshabilitan mientras envían.
15. **Punto de entrada:** un enlace con aspecto de botón «Contenido digital» junto a «Registrar libro» en `/` (solo para personal, en el mismo componente con `<Suspense>` y `connection()`). No se añade nada a la barra.

## Entradas y salidas
| Operación | Entrada | Salida |
| --- | --- | --- |
| `GET /api/books/:id/digital` | — | 200 `DigitalInfo` · 401 · 403 · 404 |
| `PATCH /api/books/:id/digital/copies` | `{ digital_copies: 0–100 }` | 200 `DigitalInfo` · 400 · 401 · 403 · 404 · 409 |
| `PUT /api/books/:id/digital/content` | `{ markdown }` (1 – 2 000 000 bytes UTF-8, sin `\u0000`) | 200 `DigitalInfo` · 400 · 401 · 403 · 404 · 409 · 429 |

Errores esperados (clase → cuándo): `UnauthorizedError` sin sesión · `ForbiddenError` rol insuficiente u origen · `NotFoundError` libro inexistente · `ConflictError` copias por debajo de los préstamos activos o subida simultánea · `ZodError` → 400 · `TooManyRequestsError` → 429.

## Autorización
- **Sí:** `BIBLIOTECARIO` y `ADMINISTRADOR` activos. **No:** prestatarios (403) y visitantes (401). El texto del libro no sale en ninguna respuesta de esta feature; ni siquiera el personal puede leerlo después de subirlo (no hay previsualización: `docs/features.md`, regla 1 del lector).

## Criterios de aceptación
- **Dado** el personal y un libro sin contenido, **cuando** sube un Markdown de 1 KB, **entonces** 200 con `has_content = true`, `content_bytes` igual al tamaño en bytes y `content_updated_at` con el instante; el archivo existe en el almacén con una ruta bajo `books/{id}/`.
- **Dado** que ya había contenido, **cuando** sube otro, **entonces** el libro apunta al archivo nuevo, el anterior se borra y el almacén queda con un solo archivo para ese libro.
- **Dado** que la actualización del libro falla tras subir el archivo, **entonces** el archivo nuevo se borra y el libro conserva el contenido anterior.
- **Dado** dos subidas simultáneas al mismo libro, **entonces** una responde 200 y la otra 409, y solo queda el archivo de la ganadora.
- **Dado** que el borrado del archivo anterior falla, **entonces** la subida responde 200 y se registra un aviso sin contenido ni ruta.
- **Dado** un `markdown` vacío, solo con espacios, de 2 000 001 bytes, con `\u0000` o ausente, **entonces** 400; de 2 000 000 bytes exactos, 200. **Dado** texto con tildes, emojis y saltos de línea, **entonces** `content_bytes` cuenta bytes UTF-8 (no caracteres).
- **Dado** `digital_copies` de −1, 101, decimal, texto o ausente, **entonces** 400; de 0, 1 y 100, 200.
- **Dado** un libro sin campos digitales (existente), **entonces** `GET` devuelve `digital_copies = 0` y `has_content = false`.
- **Dado** que hay N préstamos digitales activos (simulados), **cuando** se intenta fijar menos de N copias, **entonces** 409 con el texto de la regla 2 y nada cambia; fijar N exacto, 200.
- **Dado** un `:id` inexistente, **entonces** 404; con `:id` mal formado (`a/b`), 400; un prestatario recibe 403 en ambos casos y sin sesión 401; otro origen en `PUT`/`PATCH`, 403.
- **Dado** 21 subidas en una hora de la misma cuenta, **entonces** la 21.ª recibe 429 con `Retry-After`; otra cuenta no se ve afectada.
- **Dado** cualquier respuesta de esta feature, **entonces** no contiene el texto subido ni la ruta de Blob; **dado** una respuesta de error 500, **entonces** el cuerpo dice «Error interno» y el log no contiene el texto.
- **Dado** `/libros/digital`, **entonces** el personal ve el buscador, elige un libro, ve su estado y puede guardar copias y subir un archivo; un prestatario ve el mensaje de acceso; un archivo de más de 2 MB o vacío se rechaza en el navegador sin llamar al servidor.
- **Dado** `/` con sesión de personal, **entonces** ve «Contenido digital» junto a «Registrar libro»; un visitante o un prestatario no ve ninguno de los dos, y la búsqueda no cambia.
- **Dado** la pantalla a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, los controles miden al menos 44 px y se usa con teclado.

## Bordes
- `markdown`: de 0, 1, 1.999.999, 2.000.000 y 2.000.001 bytes; solo espacios o saltos de línea; con `\u0000`; con HTML y scripts (se guarda tal cual); con emojis (4 bytes) justo en el límite; con `\r\n`; JSON mal formado; cuerpo sin `markdown`; `markdown` que no es texto.
- `digital_copies`: 0, 1, 100, 101, −1, `1.5`, `"3"`, `null`, ausente; igual al valor actual (idempotente, 200); por debajo de los activos; libro sin campos digitales.
- Libro: `:id` inexistente, de 128 y 129 caracteres, con «/», reservado (`.`, `__x__`); libro sin contenido y con contenido; libro cuyo documento está corrupto → 500 sin detalle.
- Almacén: falla `put` (→ 500, nada cambia), falla la actualización del libro (se borra el archivo nuevo), falla el borrado del anterior (200 con aviso), falla el borrado del nuevo durante la compensación (se registra y se propaga el error original).
- Concurrencia: dos `PUT` a la vez; `PATCH` de copias mientras se sube contenido (independientes); doble clic en «Subir contenido».
- Sesión caducada a mitad de la subida; sin red; archivo que cambia entre elegirlo y enviarlo.

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `reader/schema.ts` (nuevo) | orquestador | `DIGITAL_RULES = { maxCopies: 100, maxMarkdownBytes: 2_000_000 }`; `SetDigitalCopiesInputSchema = { digital_copies: int 0–100 }`; `UploadContentInputSchema = { markdown: string }` (el límite de **bytes** y el `\u0000` los comprueba el servicio); `DigitalInfoSchema = { book_id, title, digital_copies, has_content, content_bytes: int ≥ 0 \| null, content_updated_at: string \| null }` y sus tipos |
| `reader/server/repository.ts` | backend | Puertos: `ContentStore` (`put(bookId, markdown): Promise<{ path: string }>`, `get(path): Promise<string \| undefined>`, `remove(path): Promise<void>`), `DigitalBookRepository` (`find(bookId): Promise<DigitalBookRecord \| undefined>` con título, `digital_copies` y datos del contenido; `setCopies(bookId, n)`; `replaceContent(bookId, expectedPath: string \| null, next: { path, bytes, updatedAt }): Promise<{ previousPath: string \| null }>` en una transacción que lanza `ConflictError` si la ruta esperada cambió) y `ActiveDigitalLoansReader` (`countActiveDigitalByBook(bookId): Promise<number>`; F38 lo implementa) |
| `reader/server/repository.memory.ts` | backend | `ContentStore` y `DigitalBookRepository` en memoria (con fallos inyectables para las pruebas), y el contador falso |
| `reader/server/content-store.blob.ts` | backend | `ContentStore` con `@vercel/blob` (versión ≥ 2.3, instalada con `npm install`): `put` con `access: "private"` y `addRandomSuffix`, `remove` con `del`. Sin leer el token ni exponerlo; **no** se usa en pruebas (Blob no tiene emulador). La persona confirmó (2026-10-25) que su archivo de entorno ya tiene `BLOB_STORE_ID`: se declara como variable **opcional** en `.env.example` y en `env.ts` (`BLOB_STORE_ID`, texto recortado; sin comprobar formato; ausente = «pendiente», no es un problema; el código solo la declara, la lee el SDK) y el informe de `check:env` la lista sin valor (ADR-0003) |
| `reader/server/digital-repository.firestore.ts` | backend | `DigitalBookRepository` sobre `books/{id}` (campos de «Qué hay hoy»), con Zod al leer (`digital_copies` por defecto 0) y transacción en `replaceContent` |
| `reader/server/digital-service.ts` | backend | `info(actor, bookId)`, `setCopies(actor, bookId, input)`, `uploadContent(actor, bookId, input, now)`; reglas 1–12; el tiempo se inyecta (`now`); orden de la regla 10; compensación de la regla 6 |
| `container.ts` · `shared/server/security/rate-limit.ts` | backend | Conectar `digital`; `RATE_LIMITS.contentUpload = { limit: 20, windowMs: 3_600_000 }` |
| `app/api/books/[id]/digital/route.ts` (GET) · `…/digital/copies/route.ts` (PATCH) · `…/digital/content/route.ts` (PUT) | backend | Reglas 1–12 |
| `app/libros/digital/page.tsx` · `reader/ui/digital-panel.tsx` · `reader/ui/digital-forms.tsx` (+ buscador de libro) | frontend | Reglas 13–14; funciones puras exportadas para probar sin navegador (p. ej. `describeDigitalState`, `validateMarkdownFile`, `messageForDigitalError<T>(error: T)`) |
| `app/page.tsx` · `app/register-book-link.tsx` | frontend | Regla 15 |
| Pruebas | tests | Todos los criterios con almacén y repositorio en memoria y fallos inyectables; rutas HTTP (401/403/404/409/429, orden de errores, que ninguna respuesta contenga el texto ni la ruta); límite de bytes UTF-8 (2.000.000/2.000.001, emojis, `\r\n`); compensaciones; concurrencia; pantallas con `renderToStaticMarkup`; y que `GET /api/books` y la búsqueda no cambien |

Reparto sugerido: orquestador fija `reader/schema.ts` → **backend** (primero: instala `@vercel/blob`, puertos, servicio, adaptadores y rutas) → **frontend** ∥ **tests del backend** → pruebas de las pantallas → `npm run check:full` → `security` → handoff.

## Fuera de alcance
Dividir el texto en páginas y mostrarlo (F28), el préstamo digital (F38), la marca de agua y el bloqueo al perder el foco (F29, F30), progreso y marcadores (F31), incidentes (F32), quitar el contenido de un libro, importar EPUB u otros formatos, previsualizar el texto, saneado del Markdown (se hace al mostrarlo), mostrar la disponibilidad digital en la búsqueda pública, versiones o historial del contenido, un script que borre archivos huérfanos de Blob, cuotas por libro más allá del tamaño.

## Preguntas abiertas (resueltas)
La persona aceptó la propuesta de cada una:
1. **Tamaño máximo:** 2 MB de texto por libro (regla 4).
2. **Formatos del archivo:** texto UTF-8 con extensión `.md`, `.markdown` o `.txt` (regla 13).
3. **Reemplazar con lectores activos:** se permite (regla 7).
4. **Quitar el contenido:** no se puede, solo reemplazar; para dejar de prestarlo se pone `digital_copies = 0` (regla 8).
5. **Punto de entrada:** botón «Contenido digital» junto a «Registrar libro» en `/` y pantalla propia `/libros/digital` (regla 15).
6. **Archivos huérfanos de Blob:** solo se registra un aviso, sin script de limpieza (regla 6).
7. **Límite de cargas:** 20 por hora por cuenta de personal (regla 10).
