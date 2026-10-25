# F34–F35 · Pantallas de préstamos: `/prestamos`, `/mis-prestamos` y `/mis-vencidos`

- **Estado:** Borrador
- **Rol(es):** F34 personal (`BIBLIOTECARIO`, `ADMINISTRADOR`) · F35 prestatario (`EXTERNO`, `ESTUDIANTE`, `DOCENTE`)
- **Contrato afectado:** `app/features/loans/schema.ts` (`ActiveLoanSchema`, `LoanServicePort.listActive` y `listActiveByMember`) — ver «Cambios al contrato». `app/shared/schema.ts` no cambia.
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
4. No se añaden rutas HTTP de lectura: las pantallas leen en el servidor con el contenedor, igual que `/` y `/cuentas`. Las acciones de escribir usan las rutas que ya existen (`POST /api/loans`, `POST /api/loans/:id/return`). `GET /api/members/:id/loans` sigue siendo de F23.

## Reglas de negocio

### Servicio (parte pequeña de backend)
1. `listActive`: solo personal; un prestatario → `ForbiddenError`.
2. `listActiveByMember`: misma autorización que F8: un prestatario con `memberId` ≠ su `member_id` → `ForbiddenError` **antes de consultar nada** (exista o no la otra persona); el personal puede consultar a cualquiera y si la cuenta no existe → `NotFoundError`; si el propio prestatario ya no tiene cuenta → `NotFoundError`. Una cuenta de personal consultada por el personal devuelve `[]`.
3. Ambos incluyen **también** los vencidos (con `days_late ≥ 1`) y excluyen los devueltos. Con `due_at = now` el préstamo **no** está vencido.

### F34 · `/prestamos` (personal)
4. Sin sesión → redirige a `/login`. Con sesión de un prestatario → «Solo para el personal de la biblioteca.» (`role="alert"`). El título (`<h1>`) es siempre «Préstamos».
5. **Prestar.** Una sección «Prestar un libro» con un formulario: lista desplegable «Persona» (solo cuentas **activas** con rol de prestatario; cada opción muestra «Nombre — Rol en español») y lista desplegable «Libro» (todos los libros por título; cada opción «Título — Autor (N disponibles)»; los de 0 disponibles aparecen **deshabilitados** y con el texto «agotado»), y el botón «Prestar». Ambos campos son obligatorios. Envía `POST /api/loans` con `{ member_id, book_id }` (la identidad del personal sale de la sesión).
6. Resultado de prestar, en un elemento `role="status"` / `role="alert"` enlazado al formulario: éxito → «Prestado «Título» a Nombre. Vence el 30 de enero de 2026.»; error → el mensaje del servidor (validado con `ApiErrorSchema`; p. ej. cupo lleno, vencidos, ya tiene el libro); fallo de red → «No se pudo prestar». Tras el éxito se vacía la selección y la página se recarga (`router.refresh()`) para que la lista y las cantidades disponibles se actualicen.
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
16. **Fechas y dinero:** las fechas se muestran en español de Colombia, en la zona horaria `America/Bogota`, como «30 de enero de 2026», dentro de `<time datetime="ISO">`. El dinero se muestra como «$20.000 COP». Ambos formatos viven en funciones puras (ver «Interfaz de módulos») para que sean idénticos en servidor y cliente.
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
- **Dado** una `ESTUDIANTE` activa y un libro con 1 ejemplar, **cuando** el bibliotecario los elige y pulsa «Prestar», **entonces** ve «Prestado «Título» a Nombre. Vence el …» (20 días después, en `America/Bogota`), el libro pasa a «agotado» y el préstamo aparece en la lista.
- **Dado** una persona con el cupo lleno, **cuando** el bibliotecario intenta prestarle otro, **entonces** ve el mensaje de error del servidor y no se crea nada.
- **Dado** un libro con 0 disponibles, **entonces** su opción está deshabilitada y marcada «agotado».
- **Dado** una cuenta inactiva o de personal, **entonces** no aparece en la lista «Persona».
- **Dado** un préstamo vencido hace 2 días y 10 horas, **entonces** su tarjeta dice «Vencido hace 3 días» y «Multa acumulada: $1.500 COP» (con `days_late = 3`).
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
- Pantallas: sin libros, sin personas prestatarias activas (el formulario avisa «No hay personas ni libros disponibles para prestar.» y no se puede enviar), nombre o título muy largos (se ajustan sin desbordar a 360 px), doble clic en «Prestar» o en «Confirmar devolución», sesión que expira con la página abierta (el servidor responde 401 → «Tu sesión expiró. Ingresa de nuevo.»), libro o cuenta borrados (regla 9), multa en el tope (`$20.000 COP`), «1 día» en singular y «N días» en plural.

## Interfaz de módulos (para delegar en paralelo)
| Pieza | Firma / responsabilidad |
| --- | --- |
| `loans/server/loan-service.ts` · `repository.ts` · `repository.memory.ts` · `repository.firestore.ts` | `listActive`, `listActiveByMember` (reglas 1–3) y `LoanRepository.listActive()` — **backend** |
| `loans/ui/format.ts` | Puras: `formatDate(iso: string): string` («30 de enero de 2026», `America/Bogota`), `formatCop(n: number): string` («$20.000 COP»), `formatDaysLate(n: number): string` («1 día» / «N días») — **frontend A** |
| `loans/ui/loan-rows.ts` | `LoanRow = { loan_id; book_title; book_author; member_name; member_role: Role \| null; loaned_at; due_at; days_late; fine_cop }` y `joinLoanRows(active: ActiveLoan[], members: Pick<Member,"id"\|"name"\|"role">[], books: Pick<Book,"id"\|"title"\|"author">[]): LoanRow[]` (aplica la regla 9: «Libro no disponible», «Cuenta no disponible») — **frontend A** |
| `loans/ui/lend-form.tsx` | Cliente. Props `{ members: {id; name; role}[]; books: {id; title; author; available}[] }` (regla 5–6) — **frontend A** |
| `loans/ui/active-loans-list.tsx` · `return-button.tsx` | `ActiveLoansList({ rows: LoanRow[] })` (servidor) y `ReturnButton({ loan_id; book_title })` cliente con los dos pasos (reglas 7–8) — **frontend A** |
| `app/prestamos/page.tsx` | Página de servidor (reglas 4, 15): sesión, `loans.listActive`, `members.list()` (solo prestatarios activos para el formulario), `books.search("")` — **frontend A** |
| `loans/ui/loan-card.tsx` | `LoanCard({ row: LoanRow })` de solo lectura para F35 (importa `format.ts`) — **frontend B** |
| `app/mis-prestamos/page.tsx` · `app/mis-vencidos/page.tsx` | Páginas de servidor (reglas 10–13, 15): `loans.listActiveByMember` y `loans.listOverdue` con el actor de la sesión; `books.search("")` para los títulos — **frontend B** |
| `accounts/ui/nav-bar.tsx` | Enlaces de la regla 14 — **frontend B** |
| Pruebas | Servicio y repositorio en memoria (`listActive*`), `format.ts`, `joinLoanRows`, y componentes con `renderToStaticMarkup` (sin jsdom): `LendForm`, `ActiveLoansList`, `LoanCard`, `NavBar` (se actualizan las pruebas de `NavBar` por la regla 14, que cambia lo aprobado en F33) — **tests** |

Reparto sugerido: **backend** (primero, es pequeño) → **frontend A** ∥ **frontend B** ∥ **tests** → integrar con `npm run check:full` → `security` (en especial: que ninguna pantalla muestre datos de otra persona a un prestatario y que `/prestamos` no se renderice para un prestatario).

## Fuera de alcance
Pedir prestado desde el catálogo (ver pregunta 1), renovar (F24), historial de préstamos devueltos y vista de «sus préstamos» del personal para cualquiera (F23), guardar y pagar multas (F26), buscar o filtrar dentro de las listas, paginación, panel (F9), formularios de alta (F36).

## Preguntas abiertas
1. **¿Los prestatarios pueden «Pedir prestado» desde el catálogo?** F5 permite que un prestatario se preste a sí mismo por API, pero esta spec no añade ese botón: en una biblioteca física el préstamo se hace en el mostrador. Si lo quieres, se añade un botón en `/` para prestatarios con sesión (es un cambio pequeño; dímelo y lo incluyo).
2. **Zona horaria:** propongo mostrar todas las fechas en `America/Bogota` (por el peso colombiano). ¿Correcto?
3. **Listas desplegables** para elegir persona y libro: funcionan bien con unos cientos de filas. Si el catálogo o las cuentas crecen mucho, habrá que cambiarlas por una búsqueda con texto; no está en esta spec. ¿Aceptable por ahora?
