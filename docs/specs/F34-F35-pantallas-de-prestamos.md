# F34–F35 · Pantallas de préstamos: `/prestamos`, `/mis-prestamos` y `/mis-vencidos`

- **Estado:** Aprobada (la persona aprobó con «corrige eso y aprobado el spec»; las preguntas abiertas 1 y 2 se resolvieron con las propuestas de la spec)
- **Rol(es):** F34 personal (`BIBLIOTECARIO`, `ADMINISTRADOR`) · F35 prestatario (`EXTERNO`, `ESTUDIANTE`, `DOCENTE`)
- **Contrato afectado:** `app/features/loans/schema.ts` (`ActiveLoanSchema`, `LoanServicePort.listActive` y `listActiveByMember`), `app/features/accounts/schema.ts` (`SearchMembersQuerySchema`) y `app/features/catalog/schema.ts` (`limit` opcional en `SearchBooksQuerySchema`) — ver «Cambios al contrato». `app/shared/schema.ts` no cambia.
- **Depende de:** `docs/specs/F5-F8-prestamos-fisicos.md` (aprobada) y `docs/specs/F33-navegacion-y-pantallas-base.md`.
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA).

## Objetivo
El personal presta y recibe libros desde una pantalla, y cada prestatario ve sus préstamos activos y cuáles están vencidos, sin llamar a la API a mano.

## Cambios al contrato (los hace el orquestador antes de delegar)
1. Nuevo `ActiveLoanSchema = { loan: Loan, days_late: int ≥ 0, fine_cop: int ≥ 0 }`. `days_late` es `0` si el préstamo no está vencido (`due_at ≥ now`); si no, igual que en F8 (`computeDaysLate`). `fine_cop = fine.calculate(days_late)`.
2. `LoanServicePort` añade:
   - `listActive(actor, now): Promise<ActiveLoan[]>` — todos los préstamos activos (`returned_at = null`), ordenados por `due_at` ascendente.
   - `listActiveByMember(memberId, actor, now): Promise<ActiveLoan[]>` — los activos de una persona, mismo orden.
3. `LoanRepository` añade `listActive(): Promise<Loan[]>` (consulta por `returned_at == null`, solo igualdad; sin índice compuesto).
4. Las listas de las pantallas se leen en el servidor con el contenedor, igual que `/` y `/cuentas`; las acciones de escribir usan las rutas que ya existen (`POST /api/loans`, `POST /api/loans/:id/return`). `GET /api/members/:id/loans` sigue siendo de F23.
5. **Búsqueda de personas** (para elegir a quién prestar sin cargar miles de cuentas): `SearchMembersQuerySchema = { q: texto recortado de 2 a 100 caracteres con al menos una palabra de 2 o más letras o dígitos, limit: entero 1–20 (por defecto 10), lendable: booleano (por defecto false) }`. `MemberService.search(query): Promise<Member[]>` y `MemberRepository.search(q, limit, lendable)`. Ruta nueva `GET /api/members?q=&limit=&lendable=` (la ruta sin `q` conserva su comportamiento actual: lista todo, solo personal).
6. **Búsqueda de libros acotada:** `SearchBooksQuerySchema` añade `limit` opcional (entero 1–50). Sin `limit` el comportamiento de F2 no cambia; `GET /api/books?q=&limit=` lo acepta.

## Reglas de negocio

### Búsqueda de personas (backend)
B1. **Qué coincide:** se normaliza todo (minúsculas, sin tildes) y se separa en palabras por cualquier carácter que no sea letra o dígito. Una cuenta coincide si **cada palabra de `q` es el comienzo de alguna palabra** del nombre o de la parte del correo anterior a `@`. («mar per» encuentra a «María Pérez»; «perez» y «maria.perez@…» también; «ería» no.)
B2. **Resultado:** ordenado por nombre (orden español), con un máximo de `limit` cuentas. Con `lendable = true` solo cuentas **activas** con rol de prestatario; sin ese filtro, todas.
B3. **Solo personal** (`ForbiddenError` para un prestatario; 401 sin sesión). Un `q` inválido (menos de 2 caracteres, solo símbolos o espacios, más de 100) → 400; si `q` es un correo completo solo se compara lo anterior a `@`. La autorización va antes que la validación (un prestatario recibe 403 aunque `q` sea inválido).
B4. **Escala (30 000 cuentas):** nunca se leen todas. En Firestore cada cuenta guarda un campo derivado `search_keys` (los prefijos de 2 a 20 letras de cada palabra del nombre y del correo, normalizados); la búsqueda consulta por la palabra más larga de `q` (`array-contains`, sin índice compuesto), lee como máximo **200** documentos, filtra el resto (las demás palabras, `active` y rol) en memoria y devuelve los primeros `limit`. El repositorio en memoria aplica la misma regla B1 sin `search_keys`. `search_keys` es un detalle del repositorio: no sale en `Member` ni en ninguna respuesta.
B5. **Cuentas ya existentes:** hace falta rellenar `search_keys` una vez. Se entrega un script `npm run backfill:members -- --yes` (sin `--yes` solo dice cuántas cuentas cambiaría; idempotente; no toca otros campos). Las cuentas nuevas lo llevan desde su alta (también las del `seed`).

### Servicio de préstamos (parte pequeña de backend)
1. `listActive`: solo personal; un prestatario → `ForbiddenError`.
2. `listActiveByMember`: misma autorización que F8: un prestatario con `memberId` ≠ su `member_id` → `ForbiddenError` **antes de consultar nada** (exista o no la otra persona); el personal puede consultar a cualquiera y si la cuenta no existe → `NotFoundError`; si el propio prestatario ya no tiene cuenta → `NotFoundError`. Una cuenta de personal consultada por el personal devuelve `[]`.
3. Ambos incluyen **también** los vencidos (con `days_late ≥ 1`) y excluyen los devueltos. Con `due_at = now` el préstamo **no** está vencido.

### F34 · `/prestamos` (personal)
4. Sin sesión → redirige a `/login`. Con sesión de un prestatario → «Solo para el personal de la biblioteca.» (`role="alert"`). El título (`<h1>`) es siempre «Préstamos».
5. **Prestar.** Una sección «Prestar un libro» con un formulario de dos pasos de elección y el botón «Prestar» (deshabilitado hasta tener ambas elecciones):
   - **Persona:** un campo de texto «Buscar persona (nombre o correo)» con el botón «Buscar». Al pulsar «Buscar» (o Enter dentro del campo) se llama a `GET /api/members?q=…&limit=11&lendable=true` y debajo aparece una **lista de sugerencias** (hasta 10) con «Nombre — correo — Rol en español». Se elige una con el clic o con el teclado y queda como «Persona seleccionada: Nombre — correo» con el botón «Cambiar».
   - **Libro:** igual, «Buscar libro (título o autor)» con `GET /api/books?q=…&limit=11`; cada sugerencia muestra «Título — Autor — N disponibles»; las de 0 disponibles se muestran con «agotado» y **no se pueden elegir**.
   - Reglas comunes de los dos buscadores: mínimo 2 caracteres (con menos, el mensaje «Escribe al menos 2 letras.» y no se llama a la API); mientras carga, `role="status"` «Buscando…»; sin resultados, «No hay coincidencias.»; si llegan 11 resultados se muestran 10 y el aviso «Hay más resultados: escribe más para afinar.»; error de red o del servidor → mensaje en `role="alert"`; las respuestas se validan con Zod en el mismo punto; Enter dentro del campo **no envía el formulario de prestar**; el resultado se anuncia (`aria-live="polite"`: «N sugerencias»). Una búsqueda nueva reemplaza la lista anterior; si se responden fuera de orden, solo vale la última.
   - Envía `POST /api/loans` con `{ member_id, book_id }` (la identidad del personal sale de la sesión).
6. Resultado de prestar, en un elemento `role="status"` / `role="alert"` enlazado al formulario: éxito → «Prestado «Título» a Nombre. Vence el 30 de enero de 2026.»; error → el mensaje del servidor (validado con `ApiErrorSchema`; p. ej. cupo lleno, vencidos, ya tiene el libro); fallo de red → «No se pudo prestar». Tras el éxito se limpian las dos elecciones y la página se recarga (`router.refresh()`) para que la lista se actualice.
7. **Préstamos activos.** Una sección «Préstamos activos» con una lista de `<article>`, ordenada por vencimiento (los más urgentes primero). Cada elemento muestra: título del libro, autor, nombre de la persona y su rol, fecha de préstamo, fecha de vencimiento y el estado: «En plazo» o «Vencido hace N días» con el texto «Multa acumulada: $X COP»; el estado nunca se indica solo con color (icono + texto). Sin préstamos: «No hay préstamos activos.»
8. **Devolver.** Cada elemento tiene el botón «Devolver». Como no se puede deshacer, es de **dos pasos**: el primer clic cambia el botón a «Confirmar devolución» y aparece «Cancelar»; el segundo envía `POST /api/loans/:id/return` sin cuerpo. Resultado: éxito → «Devuelto «Título». Sin multa.» o «Devuelto «Título». Multa: $X COP (se informa; no se guarda).»; error → mensaje del servidor; red → «No se pudo devolver». Tras el éxito se recarga la lista. Mientras envía, el botón queda deshabilitado (no hay doble envío).
9. Si el libro o la cuenta de un préstamo ya no existen, la tarjeta muestra «Libro no disponible» / «Cuenta no disponible» (con el id) y sigue permitiendo devolver.

### F35 · `/mis-prestamos` y `/mis-vencidos` (prestatario)
10. Sin sesión → redirige a `/login`. Con sesión de personal → «Solo para quienes piden libros prestados.» (`role="alert"`; el personal ve los de cualquiera en F23). Los títulos son «Mis préstamos» y «Mis vencidos».
11. **`/mis-prestamos`:** lista de `<article>` con los préstamos **activos propios** (`listActiveByMember` con el `member_id` de la sesión), mismos datos y estado que la regla 7 (sin la persona), ordenados por vencimiento. Encima, un resumen: «N de M préstamos activos» donde M es el cupo del rol (`maxActiveLoansByRole`). Sin préstamos: «No tienes préstamos activos.» Sin botones de acción (renovar es F24).
12. **`/mis-vencidos`:** lista de `<article>` con los vencidos propios (`listOverdue`, F8): libro, autor, fecha de vencimiento, «Vencido hace N días» y «Multa acumulada: $X COP». Si hay al menos uno, un aviso `role="status"`: «No podrás pedir libros prestados hasta devolverlos.» Sin vencidos: «No tienes préstamos vencidos.»
13. Una cuenta que no puede cargarse (inexistente) → pantalla de error de la app (`app/error.tsx`).

### Comunes
14. **Navegación (cambia `NavBar` de F33):** con rol de personal, además de «Cuentas» aparece **«Préstamos»** (a `/prestamos`); con rol de prestatario aparecen **«Mis préstamos»** (a `/mis-prestamos`) y **«Mis vencidos»** (a `/mis-vencidos`); sin sesión no aparece ninguna. Es solo presentación: el servidor sigue comprobando el rol. Orden: Biblioteca · (Préstamos · Cuentas | Mis préstamos · Mis vencidos).
15. Las páginas leen la sesión y los datos en el servidor dentro de un `<Suspense>` (Cache Components); todo `catch` que envuelva `cookies()` o lecturas de sesión llama primero a `unstable_rethrow(error)` (regla 6 de F33).
16. **Fechas y dinero:** las fechas se muestran en español, **en la hora local de quien mira**: se usa la zona horaria que el navegador informa (`Intl.DateTimeFormat().resolvedOptions().timeZone`); no se pide permiso de ubicación ni se usa geolocalización. Como el servidor no conoce esa zona, el HTML inicial trae la fecha en `America/Bogota` y, al montarse, un componente de cliente (`LocalDate`) la reescribe con la zona del navegador (sin errores de hidratación: el `<time datetime="ISO">` es el mismo). Formato: «30 de enero de 2026» y, donde importa la hora (vencimiento), «30 de enero de 2026, 3:45 p. m.». El dinero se muestra como «$20.000 COP». Los formatos viven en funciones puras que reciben la zona como parámetro (ver «Interfaz de módulos»). Los días de retraso los calcula el servidor con los instantes UTC y no cambian con la zona.
17. Disposición: una columna a 360 px, dos desde 768 px y tres desde 1024 px (como `/` y `/cuentas`). Sin desplazamiento horizontal, objetivos táctiles ≥ 44 px, foco visible, uso completo con teclado.

## Entradas y salidas
| Pantalla | Entrada | Salida |
| --- | --- | --- |
| `/prestamos` | cookie de sesión | formulario de prestar + lista de `ActiveLoan` con nombres y títulos · redirección · mensaje de acceso |
| Prestar | `member_id`, `book_id` elegidos | `POST /api/loans` → mensaje de éxito o error |
| Devolver | clic y confirmación | `POST /api/loans/:id/return` → `ReturnResult` y mensaje |
| `/mis-prestamos` | cookie de sesión | resumen de cupo + lista de `ActiveLoan` |
| `/mis-vencidos` | cookie de sesión | lista de `OverdueLoan` |

## Autorización
| Pantalla / operación | Puede | No puede |
| --- | --- | --- |
| `/prestamos`, `listActive` | Personal | Prestatario (mensaje de acceso / `ForbiddenError`); sin sesión (redirección) |
| `/mis-prestamos`, `/mis-vencidos` | Prestatario (los propios) | Personal (mensaje de acceso); sin sesión (redirección) |
| `listActiveByMember` | Prestatario los suyos; personal los de cualquiera | Prestatario los de otra persona (`ForbiddenError`, exista o no) |

La identidad sale siempre de la sesión; ningún dato de las pantallas puede cambiar de quién son los préstamos que se consultan.

## Criterios de aceptación
- **Dado** un bibliotecario con sesión, **cuando** abre `/prestamos`, **entonces** ve «Prestar un libro» y «Préstamos activos» y la barra muestra «Préstamos» y «Cuentas».
- **Dado** una `ESTUDIANTE` activa y un libro con 1 ejemplar, **cuando** el bibliotecario los elige y pulsa «Prestar», **entonces** ve «Prestado «Título» a Nombre. Vence el …» (20 días después, en la hora local del navegador), el libro pasa a «agotado» y el préstamo aparece en la lista.
- **Dado** 30 000 cuentas, **cuando** el bibliotecario escribe «mar per» y pulsa «Buscar», **entonces** ve como máximo 10 sugerencias (p. ej. «María Pérez — …»), no se leyeron todas las cuentas y no aparecen cuentas inactivas ni de personal.
- **Dado** que el campo tiene 1 carácter, **cuando** pulsa «Buscar», **entonces** ve «Escribe al menos 2 letras.» y no se llama a la API.
- **Dado** que escribe en el campo de persona y pulsa Enter, **entonces** se hace la búsqueda y **no** se envía el formulario de prestar.
- **Dado** una búsqueda con 11 coincidencias, **entonces** se muestran 10 y el aviso «Hay más resultados: escribe más para afinar.»
- **Dado** una persona o libro elegido, **cuando** pulsa «Cambiar», **entonces** vuelve el campo de búsqueda y «Prestar» queda deshabilitado.
- **Dado** un navegador en la zona horaria `America/Mexico_City`, **cuando** ve un vencimiento guardado como `2026-01-30T20:45:00.000Z`, **entonces** lo ve como «30 de enero de 2026, 2:45 p. m.»; **y** en `America/Bogota`, «3:45 p. m.»
- **Dado** una persona con el cupo lleno, **cuando** el bibliotecario intenta prestarle otro, **entonces** ve el mensaje de error del servidor y no se crea nada.
- **Dado** un libro con 0 disponibles, **entonces** aparece en las sugerencias marcado «agotado» y no se puede elegir.
- **Dado** una cuenta inactiva o de personal, **entonces** no aparece en las sugerencias de «Persona».
- **Dado** un prestatario con sesión, **cuando** llama a `GET /api/members?q=ana`, **entonces** 403; sin sesión, 401; con `q=a`, 400.
- **Dado** los nombres «María Pérez» y «Pedro Martínez», **cuando** se busca «mar», **entonces** salen ambos (por «María» y «Martínez»); con «per» sale «María Pérez»; con «ería» no sale ninguno.
- **Dado** un préstamo vencido hace 2 días y 10 horas, **entonces** su tarjeta dice «Vencido hace 3 días» y «Multa acumulada: $1.500 COP» (con `days_late = 3`), sea cual sea la zona horaria del navegador.
- **Dado** un préstamo activo, **cuando** el bibliotecario pulsa «Devolver», **entonces** aparece «Confirmar devolución» y «Cancelar» y todavía no se envía nada; **y** al cancelar vuelve el botón «Devolver»; **y** al confirmar se envía una sola petición y la tarjeta desaparece de la lista.
- **Dado** una devolución tardía con multa de 1.000 COP, **entonces** el mensaje dice «Multa: $1.000 COP».
- **Dado** un `EXTERNO` con 2 préstamos activos, **cuando** abre `/mis-prestamos`, **entonces** ve «2 de 3 préstamos activos» y sus dos tarjetas ordenadas por vencimiento, sin botones.
- **Dado** un `DOCENTE`, **entonces** ve «N de 5 préstamos activos».
- **Dado** un prestatario sin vencidos, **cuando** abre `/mis-vencidos`, **entonces** ve «No tienes préstamos vencidos.»; **y** con uno vencido ve su tarjeta y el aviso «No podrás pedir libros prestados hasta devolverlos.»
- **Dado** un prestatario, **cuando** abre `/prestamos` escribiendo la dirección, **entonces** ve «Solo para el personal de la biblioteca.»; **dado** un bibliotecario en `/mis-prestamos`, ve «Solo para quienes piden libros prestados.»
- **Dado** un visitante sin sesión, **cuando** abre cualquiera de las tres pantallas, **entonces** es redirigido a `/login`.
- **Dado** un prestatario, **cuando** llama a `listActiveByMember` con el `member_id` de otra persona (exista o no), **entonces** `ForbiddenError`; **dado** el personal con un id inexistente, `NotFoundError`.
- **Dado** cualquier pantalla a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, el foco se ve, los controles miden al menos 44 px y se puede usar solo con teclado.

## Bordes
- Servicio: 0 préstamos activos, 1, varios; `due_at = now − 1 ms`, `now`, `now + 1 ms`; préstamos devueltos (no aparecen); cuenta de personal consultada por el personal (`[]`); orden con `due_at` repetido (desempata por `loaned_at` y luego por `id`).
- Búsqueda: `q` de 1, 2 y 100 caracteres y de 101; solo símbolos; tildes y mayúsculas («JOSE» encuentra «José»); correo completo; mismo nombre en varias cuentas (se distinguen por el correo); `limit` 1, 20 y 21; `lendable` con cuentas inactivas, de personal y `DOCENTE`; 200 documentos leídos como tope; `search_keys` ausente en una cuenta antigua (no aparece hasta el backfill).
- Pantallas: respuestas de búsqueda que llegan fuera de orden, buscar y cambiar de elección antes de que responda, nombre o título muy largos (se ajustan sin desbordar a 360 px), doble clic en «Prestar» o en «Confirmar devolución», sesión que expira con la página abierta (el servidor responde 401 → «Tu sesión expiró. Ingresa de nuevo.»), libro o cuenta borrados (regla 9), multa en el tope (`$20.000 COP`), «1 día» en singular y «N días» en plural.

## Interfaz de módulos (para delegar en paralelo)
| Pieza | Firma / responsabilidad |
| --- | --- |
| `loans/server/loan-service.ts` · `repository.ts` · `repository.memory.ts` · `repository.firestore.ts` | `listActive`, `listActiveByMember` (reglas 1–3) y `LoanRepository.listActive()` — **backend A** |
| `accounts/server/member-search.ts` · `repository.ts` · `repository.memory.ts` · `repository.firestore.ts` · `member-service.ts` | Puras: `normalizeWords(text: string): string[]`, `matchesMemberQuery(record, q): boolean` (B1) y `buildSearchKeys(name, email): string[]` (B4). `MemberRepository.search(q: string, limit: number, lendable: boolean): Promise<MemberRecord[]>`; `MemberService.search(query): Promise<Member[]>`; `create` guarda `search_keys` (campo interno) — **backend B** |
| `app/api/members/route.ts` | `GET` con `q` → búsqueda (B3, 200 `Member[]`); sin `q`, como hoy — **backend B** |
| `app/api/books/route.ts` · `catalog/server/*` | Aceptan `limit` (regla 6) — **backend B** |
| `BookService.getSummaries(ids: Id[]): Promise<Pick<Book,"id"|"title"|"author">[]>` (mismas reglas que `getMany` pero **sin** calcular `available`: las pantallas de préstamos solo necesitan título y autor, y contar préstamos por libro cuesta una lectura por libro) · `BookService.getMany(ids: Id[]): Promise<Book[]>` · `MemberService.getMany(ids: Id[]): Promise<Member[]>` + repositorios y contenedor | Lectura por id de solo los libros / cuentas de los préstamos listados (con `available` en libros). Ids repetidos o inexistentes se ignoran; se aceptan hasta 500 ids por llamada (Firestore `getAll`); `[]` → `[]`. Las pantallas no leen nunca el catálogo ni las cuentas completos — **backend C** |
| `scripts/backfill-member-search.ts` + script `backfill:members` en `package.json` | B5 (ampliación puntual de la zona de backend) — **backend B** |
| `loans/ui/format.ts` | Puras: `formatDate(iso: string, timeZone: string): string` («30 de enero de 2026»), `formatDateTime(iso, timeZone)` («30 de enero de 2026, 3:45 p. m.»), `formatCop(n: number): string` («$20.000 COP»), `formatDaysLate(n: number): string` («1 día» / «N días»). Constante `DEFAULT_TIME_ZONE = "America/Bogota"` — **frontend A** |
| `loans/ui/local-date.tsx` | Cliente: `LocalDate({ iso: string; withTime?: boolean })` renderiza `<time datetime={iso}>` con `DEFAULT_TIME_ZONE` y, tras montarse, con la zona del navegador (regla 16) — **frontend A** |
| `loans/ui/member-picker.tsx` · `book-picker.tsx` | Cliente. Buscador con botón y lista de sugerencias (regla 5): `MemberPicker({ onSelect(member: Member): void; selected: Member \| null; onClear(): void })` y `BookPicker` análogo con `Book` — **frontend A** |
| `loans/ui/loan-rows.ts` | `LoanRow = { loan_id; book_title; book_author; member_name; member_role: Role \| null; loaned_at; due_at; days_late; fine_cop }` (refleja los campos del cable, por eso va en snake_case; los props de componentes sí van en camelCase) y `joinLoanRows(active: ActiveLoan[], members: Pick<Member,"id"\|"name"\|"role">[], books: Pick<Book,"id"\|"title"\|"author">[]): LoanRow[]` (aplica la regla 9: «Libro no disponible», «Cuenta no disponible») — **frontend A** |
| `loans/ui/lend-form.tsx` | Cliente. Sin props de datos: usa `MemberPicker` y `BookPicker` y envía `POST /api/loans` (reglas 5–6) — **frontend A** |
| `loans/ui/active-loans-list.tsx` · `return-button.tsx` | `ActiveLoansList({ rows: LoanRow[] })` (servidor) y `ReturnButton({ loanId: string; bookTitle: string })` cliente (props en camelCase: el snake_case es solo del cable, AGENTS.md) con los dos pasos (reglas 7–8) — **frontend A** |
| `app/prestamos/page.tsx` | Página de servidor (reglas 4, 15): sesión, `loans.listActive`, y para los nombres y títulos de las tarjetas solo las cuentas y libros de esos préstamos (por id, no el catálogo completo) — **frontend A** |
| `loans/ui/loan-card.tsx` | `LoanCard({ row: LoanRow })` de solo lectura para F35 (importa `format.ts`) — **frontend B** |
| `app/mis-prestamos/page.tsx` · `app/mis-vencidos/page.tsx` | Páginas de servidor (reglas 10–13, 15): `loans.listActiveByMember` y `loans.listOverdue` con el actor de la sesión; los títulos se obtienen solo de los libros de esos préstamos (por id) — **frontend B** |
| `accounts/ui/nav-bar.tsx` | Enlaces de la regla 14 — **frontend B** |
| Pruebas | Servicio y repositorio en memoria (`listActive*`), `format.ts` (con varias zonas horarias), `matchesMemberQuery`/`buildSearchKeys`, `GET /api/members?q=` (401/403/400/200), `GET /api/books?limit=`, `joinLoanRows`, y componentes con `renderToStaticMarkup` (sin jsdom): `LendForm`, `ActiveLoansList`, `LoanCard`, `NavBar` (se actualizan las pruebas de `NavBar` por la regla 14, que cambia lo aprobado en F33) — **tests** |

Reparto sugerido: **backend A** (servicio de préstamos) ∥ **backend B** (búsqueda de personas, `limit` de libros, backfill) → **frontend A** ∥ **frontend B** ∥ **tests** → integrar con `npm run check:full` → `security` (en especial: que ninguna pantalla muestre datos de otra persona a un prestatario y que `/prestamos` no se renderice para un prestatario).

## Fuera de alcance
Pedir prestado desde el catálogo (el libro físico se presta en el mostrador; la reserva desde el catálogo es F25, otra spec), renovar (F24), buscar personas por documento de identidad o código estudiantil (ver pregunta 1), historial de préstamos devueltos y vista de «sus préstamos» del personal para cualquiera (F23), guardar y pagar multas (F26), buscar o filtrar dentro de las listas de préstamos, paginación, caché y mejora de la búsqueda de libros (sigue leyendo el catálogo completo; pendiente de seguridad ya anotado), panel (F9), formularios de alta (F36).

## Preguntas abiertas (resueltas)
Resueltas por la persona: (a) el libro físico se presta en el mostrador, la reserva desde el catálogo será otra spec (F25); (b) las fechas se muestran en la hora local de quien mira; (c) personas y libros se eligen con un campo, un botón «Buscar» y una lista de sugerencias, no con listas desplegables.

1. La cuenta se identifica solo por nombre y correo; buscar por cédula o código estudiantil queda para una spec posterior (hay que añadir ese campo a la cuenta).
2. `search_keys` con el script de rellenado `backfill:members` (B5): enfoque aprobado, para no leer todas las cuentas en cada búsqueda.
