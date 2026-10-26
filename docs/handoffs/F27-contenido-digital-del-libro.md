## Entrega: orquestador · F27 (contenido digital del libro)
**Hecho:**
- **Contrato** `app/features/reader/schema.ts` (`DIGITAL_RULES`, `SetDigitalCopiesInputSchema`, `UploadContentInputSchema`, `DigitalInfoSchema`). El catálogo no cambia: los campos digitales (`digital_copies`, `content_path`, `content_bytes`, `content_updated_at`) viven en `books/{id}` y son del lector.
- **Backend:** puertos `ContentStore`, `DigitalBookRepository` y `ActiveDigitalLoansReader` (hoy un contador falso en 0; F38 pone el real); servicio `digital-service.ts`; adaptadores Blob (`access: "private"`, `@vercel/blob` 2.4.0) y Firestore (transacción en `replaceContent`); rutas `GET /api/books/:id/digital`, `PATCH …/copies`, `PUT …/content` (tope de cuerpo de 4 200 000 bytes con `readBodyText`, límite de 20 subidas por hora y cuenta). El texto y la ruta de Blob no salen en ninguna respuesta ni log.
- **Fallo ambiguo** (hallazgo de `security`, regla 6 de la spec): si `replaceContent` falla tras confirmarse, se relee el libro y, si ya apunta al archivo nuevo, no se borra y la subida responde 200.
- **Pantalla** `/libros/digital` (buscar libro, estado, copias digitales, subir o reemplazar contenido con confirmación en dos pasos) y botón «Contenido digital» junto a «Registrar libro» en `/` (solo personal).
- **`BLOB_STORE_ID`** declarada como variable opcional en `env.ts` y `.env.example` (la persona confirmó que ya la tiene en su archivo de entorno); `check:env` la lista sin valor.
- Revisión de `security`: **Aprobado con observaciones**, sin críticos, altos ni medios.

**Archivos:** `app/features/reader/{schema.ts,server/*,ui/*}`, `app/api/books/[id]/digital/{route.ts,copies/route.ts,content/route.ts}`, `app/shared/server/security/{body-limit,rate-limit}.ts`, `app/shared/server/env.ts`, `app/features/container.ts`, `app/libros/digital/page.tsx`, `app/register-book-link.tsx`, `.env.example`; pruebas en `app/features/reader/tests/`, `app/shared/tests/body-limit.test.ts` y `tests/helpers/digital*.ts`. Se ajustó `app/features/catalog/tests/register-book-link.test.ts` (F36) porque la regla 15 de F27 añade un segundo botón.

**Cómo verificar:** `npm run check:full` → todo en verde y build con `/libros/digital`; `npm run check:env` → línea de `BLOB_STORE_ID`.

**Decisiones:** constan solo en `docs/specs/F27-contenido-digital-del-libro.md`.

**Pendiente / bloqueos:**
- **Probar en Vercel con Blob real:** subir un `.md`, reemplazarlo (el archivo anterior debe desaparecer del store), fijar copias; nada de esto tiene emulador. Si falla `put`, revisar `BLOB_READ_WRITE_TOKEN`/`BLOB_STORE_ID`.
- **Revisión visual** de `/libros/digital` y de los dos botones de `/` a 360, 768 y 1024 px (el agente no tuvo navegador); la confirmación en dos pasos y el foco solo se comprueban a mano.
- **Pruebas que faltan:** `content-store.blob.ts` y el repositorio de Firestore (`replaceContent` con el emulador).
- **Para F28:** el Markdown se guarda tal cual (puede traer HTML/scripts): el lector debe usar un renderizador sin HTML crudo, validar enlaces (`javascript:`) y probarlo con cargas de XSS.
- **Para F38:** poner el contador real de préstamos digitales activos y cerrar la carrera de `setCopies` (contar y escribir en transacciones distintas); la spec de F38 debe pedir comprobar `digital_copies` dentro de la transacción del préstamo.
- **Bajos de `security`:** el límite de subidas gasta cupo también con peticiones inválidas (es lo que dice la regla 10; el contador es por instancia, ADR-0008); el error del SDK de Blob se reduce al nombre en el log, lo que dificulta diagnosticar.

**Dudas de la especificación:**
- Regla 14: con N = 1 el código dice «Se guardó 1 copia digital» (singular); conviene aclararlo en la spec.
- `formatKilobytes` redondea cualquier archivo no vacío a al menos «0,1 KB» y usa 1 KB = 1000 bytes; la spec no lo define.
- Un `content-length` inválido se ignora y el tope se aplica sobre lo leído.
- **Riesgo residual (doble falla):** si `replaceContent` se confirma pero la respuesta se pierde **y además** falla la relectura del libro, el servicio lo trata como «no apunta» y borra el archivo nuevo: el libro queda con un `content_path` muerto. Más seguro sería no borrar cuando la relectura falla (un huérfano es inofensivo; un puntero roto no). Decidirlo con la persona y, si se acepta, enmendar la regla 6 y sus pruebas (`digital-upload-ambiguous.test.ts`, caso 4).
