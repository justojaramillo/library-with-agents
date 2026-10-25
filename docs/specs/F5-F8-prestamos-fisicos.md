# F5–F8 · Préstamos de libros físicos: prestar, devolver, multa por retraso y vencidos

- **Estado:** Aprobada (la persona aprobó con «aprobado, construye»; las tres preguntas abiertas se resolvieron con las propuestas de la spec)
- **Rol(es):** F5 personal, o el prestatario solo a sí mismo · F6 personal · F7 sistema · F8 prestatario (los suyos) y personal (cualquiera)
- **Contrato afectado:** `app/features/loans/schema.ts` (`LOAN_RULES`, `LoanServicePort`) — cambios listados en «Cambios al contrato». `app/shared/schema.ts` no cambia.

## Objetivo
El personal presta y recibe libros físicos con plazo, cupo y multa según las reglas del rol; el prestatario puede pedir prestado a su nombre y ver cuáles de sus préstamos están vencidos.

## Cambios al contrato (los hace el orquestador antes de delegar)
1. `LOAN_RULES.maxActiveLoansPerMember` **se elimina** y se reemplaza por `maxActiveLoansByRole = { EXTERNO: 3, ESTUDIANTE: 3, DOCENTE: 5 }`.
2. Se añade `LOAN_RULES.maxRenewalsByRole = { EXTERNO: 2, ESTUDIANTE: 2, DOCENTE: 3 }` (lo usa F24; se fija ahora para no tocar el contrato dos veces).
3. `LoanServicePort` recibe al actor (la identidad sale de la sesión, regla 4 de `AGENTS.md`):
   `lend(input, actor, now)`, `returnLoan(loanId, actor, now)`, `listOverdue(memberId, actor, now)`.
4. `Loan` **no cambia** en esta spec. Todo préstamo de F5 es físico; F38 añadirá el tipo `FISICO|DIGITAL` con `FISICO` por defecto para los documentos existentes.
5. La prueba `app/features/loans/tests/loan-rules.test.ts` (que hoy exige `maxActiveLoansPerMember = 3`) se reescribe desde esta spec: el cambio viene de una decisión de la persona, no de hacer pasar una prueba.

## Reglas de negocio

### F5 · Prestar
1. **Autorización previa.** Si el actor es prestatario y `member_id` ≠ su propio `member_id` → `ForbiddenError`, **sin consultar nada más** (no se revela si la otra persona existe). Si el actor es personal, puede prestar a cualquier `member_id`.
2. Orden de las comprobaciones (fija, para que los errores sean predecibles): (a) autorización previa → (b) la cuenta `member_id` existe, si no `NotFoundError` → (c) el libro existe, si no `NotFoundError` → (d) la cuenta es de un prestatario (`EXTERNO`, `ESTUDIANTE`, `DOCENTE`), si no `ForbiddenError` (el personal no pide prestado con su cuenta de trabajo) → (e) la cuenta está activa, si no `ConflictError` → (f) no tiene préstamos activos vencidos, si no `ConflictError` → (g) la persona no tiene ya un ejemplar activo de ese libro, si no `ConflictError` → (h) cupo → (i) ejemplar disponible.
3. **Cupo (h):** préstamos activos de la persona (`returned_at = null`, vencidos incluidos) < `maxActiveLoansByRole[rol]` (3, 3, 5). Si ya tiene el máximo → `ConflictError`.
4. **Disponibilidad (i):** préstamos activos del libro < `copies` del libro. Si no → `ConflictError`.
5. **Plazo:** `loaned_at = now` y `due_at = now + días_del_rol × 86 400 000 ms` (15, 20 o 30 días; sin calendario ni zona horaria), ambos en ISO 8601 UTC. El plazo sale del rol **vigente al prestar** y no se recalcula después. `returned_at = null`.
6. **Bloqueo por deuda (f):** en esta spec, «deuda» = al menos un préstamo activo con `due_at` < `now`. Las multas sin pagar se suman al bloqueo cuando exista F26.
7. **Atomicidad:** la comprobación de cupo y de disponibilidad y la creación del préstamo ocurren en una sola operación atómica del repositorio (transacción en Firestore). Con dos peticiones simultáneas por el último ejemplar, o por el último lugar del cupo, solo una crea el préstamo y la otra recibe `ConflictError`.
8. Un mismo libro puede tener varios préstamos activos de personas distintas (uno por ejemplar), pero **una persona no puede tener dos préstamos activos del mismo libro** (`ConflictError`).

### F6 · Devolver
1. Solo el personal (`BIBLIOTECARIO`, `ADMINISTRADOR`); un prestatario → `ForbiddenError`.
2. El préstamo debe existir → si no, `NotFoundError`. Si ya tiene `returned_at` → `ConflictError` (no se devuelve dos veces).
3. Se guarda `returned_at = now` (ISO UTC) y se responde `{ loan, fine_cop }`.
4. `days_late` = `0` si `now ≤ due_at`; si no, `ceil((now − due_at) / 86 400 000)`. `fine_cop = fine.calculate(days_late)`.
5. La multa **solo se informa** en la respuesta; no se guarda hasta F26 (ver pregunta abierta 2).
6. Devolver libera el ejemplar y el cupo: la siguiente consulta de `available` y de cupo ya los cuenta.

### F7 · Multa por retraso
1. `FineStrategy.calculate(daysLate)` (patrón Strategy, intercambiable sin tocar `loan-service`).
2. La multa diaria por defecto es `min(daysLate × 500, 20 000)` COP, igual para todos los roles; `daysLate ≤ 0` → `0`. Con los valores por defecto el tope se alcanza a los 40 días.
3. `createDailyFineStrategy(ratePerDay, cap)` acepta otros valores y sin argumentos usa `LOAN_RULES.fineCopPerDay` y `LOAN_RULES.fineCapCop`.
4. Función pura `computeDaysLate(dueAt: string, now: Date): number` (en `loans/server`), la usan F6 y F8: cualquier fracción de día pasado el vencimiento cuenta como un día completo; exactamente en `due_at` es `0`.

### F8 · Vencidos de una persona
1. Si el actor es prestatario y `memberId` ≠ su `member_id` → `ForbiddenError` **aunque esa persona no exista**. Si el actor es personal y la cuenta no existe → `NotFoundError`. Si el actor es el propio prestatario y su cuenta ya no existe → `NotFoundError`.
2. Devuelve solo préstamos **activos** con `due_at` < `now` (estricto: con `due_at = now` no está vencido), ordenados por `due_at` ascendente.
3. Cada elemento: `{ loan, days_late (≥ 1), fine_cop }` con `days_late = computeDaysLate` y `fine_cop = fine.calculate(days_late)`.
4. Una cuenta de personal consultada por el personal existe y devuelve `[]`.

## Entradas y salidas
| Operación | Entrada | Salida exitosa |
| --- | --- | --- |
| `POST /api/loans` | cuerpo `LendInput` `{ member_id, book_id }` (ids no vacíos); el actor sale de la sesión | `201` con `Loan` |
| `POST /api/loans/:id/return` | `:id` del préstamo; sin cuerpo | `200` con `ReturnResult` |
| `GET /api/members/:id/overdue` | `:id` de la cuenta | `200` con `OverdueLoan[]` (puede ser `[]`) |

Errores (cuerpo `ApiError`): `400` cuerpo inválido o ids vacíos · `401` sin sesión · `403` `ForbiddenError` · `404` `NotFoundError` · `409` `ConflictError`. Las rutas siguen `docs/specs/F0-base-del-proyecto.md` (origen, sesión, errores).

## Autorización
| Operación | Puede | No puede |
| --- | --- | --- |
| Prestar | Personal a cualquier prestatario activo; prestatario solo a su propio `member_id` | Prestatario a otra persona (403); prestar a una cuenta de personal (403) |
| Devolver | Personal | Prestatario (403) |
| Vencidos | Prestatario los suyos; personal los de cualquiera | Prestatario los de otra persona (403, exista o no) |

Sin sesión: `401` en las tres rutas.

## Criterios de aceptación
- **Dado** un `ESTUDIANTE` activo y un libro con 1 ejemplar libre, **cuando** el bibliotecario presta con `now = 2026-01-10T10:00:00Z`, **entonces** `due_at = 2026-01-30T10:00:00.000Z` y `returned_at = null`.
- **Dado** un `EXTERNO`, **cuando** se le presta con el mismo `now`, **entonces** `due_at` es 15 días después; **dado** un `DOCENTE`, 30 días después.
- **Dado** un `EXTERNO` con 3 préstamos activos, **cuando** se intenta un cuarto, **entonces** `ConflictError`; **dado** un `DOCENTE` con 4, **entonces** el quinto se crea y el sexto da `ConflictError`.
- **Dado** una persona con un ejemplar activo de un libro, **cuando** pide el mismo libro otra vez (aunque queden ejemplares), **entonces** `ConflictError`; tras devolverlo, puede pedirlo.
- **Dado** un libro con 1 ejemplar ya prestado, **cuando** otra persona lo pide, **entonces** `ConflictError`; **y** tras devolverlo, el mismo pedido funciona.
- **Dado** un libro con 1 ejemplar, **cuando** dos personas lo piden a la vez (`Promise.all`), **entonces** una recibe el `Loan` y la otra `ConflictError`, y quedan exactamente 1 préstamo activo.
- **Dado** un `EXTERNO` con 2 préstamos activos de libros distintos y ejemplares de sobra, **cuando** pide a la vez dos libros más (también distintos), **entonces** uno se crea y el otro da `ConflictError` (cupo lleno), y quedan exactamente 3 activos.
- **Dado** un prestatario con sesión, **cuando** pide prestado con el `member_id` de otra persona (exista o no), **entonces** `ForbiddenError` en ambos casos con el mismo mensaje.
- **Dado** un bibliotecario, **cuando** presta con el `member_id` de un bibliotecario, **entonces** `ForbiddenError`; con un `member_id` inexistente, `NotFoundError`; con un `book_id` inexistente, `NotFoundError`.
- **Dado** un prestatario con `active = false`, **cuando** se le presta, **entonces** `ConflictError`.
- **Dado** un prestatario con un préstamo activo cuyo `due_at` es anterior a `now`, **cuando** se le presta otro libro, **entonces** `ConflictError`; **y** si su préstamo vence exactamente en `now`, **entonces** se presta.
- **Dado** un `ESTUDIANTE` al que se le prestó cuando era `ESTUDIANTE` y luego pasa a `DOCENTE`, **entonces** su préstamo anterior conserva el `due_at` original y los nuevos usan 30 días.
- **Dado** un préstamo con `due_at = T`, **cuando** se devuelve en `T`, **entonces** `fine_cop = 0`; en `T + 1 ms` (1 día de retraso), `500`; en `T + 24 h`, `500`; en `T + 24 h + 1 ms`, `1000`; en `T + 41 días`, `20000` (tope).
- **Dado** un préstamo ya devuelto, **cuando** se devuelve de nuevo, **entonces** `ConflictError` y `returned_at` no cambia.
- **Dado** un id de préstamo inexistente, **cuando** el personal lo devuelve, **entonces** `NotFoundError`; **y** si lo intenta un prestatario, `ForbiddenError` (antes de buscar el préstamo).
- **Dado** un `EXTERNO` con dos préstamos vencidos (uno hace 2 días, otro hace 10 horas) y uno vigente, **cuando** consulta los suyos, **entonces** recibe 2 elementos ordenados por `due_at`, con `days_late` 2 y 1 y `fine_cop` 1000 y 500.
- **Dado** un prestatario, **cuando** consulta los vencidos de otra persona inexistente, **entonces** `ForbiddenError`; **dado** el personal, **entonces** `NotFoundError`.
- **Dado** una petición sin sesión a cada una de las tres rutas, **entonces** `401`.

## Bordes
- Cupo: 0, cupo − 1, cupo y cupo + 1 préstamos activos, en cada rol.
- Ejemplares: libro con `copies = 1` (libre / prestado) y con `copies = N` con N prestados.
- Vencimiento: `due_at = now − 1 ms`, `now`, `now + 1 ms` (F5 y F8); devolución en `due_at`, `+1 ms`, `+24 h`, `+24 h + 1 ms`, `+40 días`, `+41 días` (F6 y F7).
- Multa: `calculate(0)`, `calculate(−1)`, `calculate(1)`, `calculate(40)`, `calculate(41)`, y con tarifa y tope distintos.
- Misma persona pidiendo dos veces el mismo libro (secuencial y simultáneo) → un solo préstamo activo.
- Ids vacíos o ausentes en el cuerpo → `400`; cuerpo con un campo extra (por ejemplo `role`, `due_at`) → se ignora y nunca se usa.
- Lista de vencidos vacía y con un solo elemento.

## Interfaz de módulos (para delegar en paralelo)
| Pieza | Firma |
| --- | --- |
| `loans/server/fine-strategy.ts` | `FineStrategy.calculate(daysLate: number): number`; `createDailyFineStrategy(ratePerDay?, cap?)`; `computeDaysLate(dueAt: string, now: Date): number` |
| `loans/server/repository.ts` | Se conserva `LoanRepository`. Se añade `createWithinLimits(newLoan: Omit<Loan, "id">, limits: { bookCopies: number; maxActiveForMember: number }): Promise<LendOutcome>` con `LendOutcome = { ok: true; loan: Loan } \| { ok: false; reason: "ALREADY_HAS_BOOK" \| "MEMBER_LIMIT" \| "NO_COPIES" }`. Comprueba, en este orden y **en una sola operación atómica**, si la persona ya tiene el libro activo, su cupo y los ejemplares, y crea el préstamo. El servicio traduce `reason` a `ConflictError` con mensaje en español |
| `loans/server/repository.memory.ts` · `repository.firestore.ts` | Implementan `createWithinLimits` (Firestore: `db.runTransaction` con las dos consultas de conteo y el alta; los documentos se validan con Zod al leer). Consultas solo con igualdad: no requieren índice compuesto |
| `loans/server/loan-service.ts` | `createLoanService({ books, members, loans, fine })` → `LoanServicePort`. Usa `listActiveByMember` para detectar vencidos. Solo aquí viven las reglas |
| `features/container.ts` | `loans` pasa de función perezosa a servicio ya construido (el backend lo ajusta) |
| Rutas | `app/api/loans/route.ts` (`POST`), `app/api/loans/[id]/return/route.ts` (`POST`), `app/api/members/[id]/overdue/route.ts` (`GET`). Validan con Zod, toman el actor de la sesión (`SessionUser` → `Actor`) y traducen errores con `handleError` |

Reparto sugerido: **backend A** = `loan-service.ts` + `fine-strategy.ts`; **backend B** = repositorios (memoria y Firestore) + rutas + `container.ts`; **tests** = desde esta spec, con el repositorio en memoria. Las pantallas (F34, F35) van en su propia spec.

## Fuera de alcance
Renovación (F24), historial «Mis préstamos» (F23), persistencia y pago de multas y su bloqueo (F26), reservas (F25), préstamos digitales (F38), libros retirados (F19), pantallas (F34–F35), panel (F9).

## Preguntas abiertas (resueltas)
1. Una misma persona **no** puede tener dos ejemplares del mismo libro a la vez → `ConflictError`, comprobado entre (f) y (g) del orden de F5 y también dentro de la operación atómica del repositorio (`reason: "ALREADY_HAS_BOOK"`).
2. Hasta F26 la multa solo se informa en la respuesta; no se guarda.
3. Antes de F26 solo bloquean los préstamos vencidos.
