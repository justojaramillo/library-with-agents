## Entrega: orquestador · F5–F8 (préstamos de libros físicos)
**Hecho:**
- Prestar (F5), devolver (F6), multa por retraso (F7) y vencidos de una persona (F8), según `docs/specs/F5-F8-prestamos-fisicos.md` (aprobada).
- Contrato: `LOAN_RULES.maxActiveLoansByRole` (3, 3, 5) y `maxRenewalsByRole` (2, 2, 3) reemplazan a `maxActiveLoansPerMember`; `LoanServicePort` recibe al `actor`. `IdSchema` ahora tiene máximo 128 caracteres y no admite «/».
- Rutas: `POST /api/loans`, `POST /api/loans/:id/return`, `GET /api/members/:id/overdue`.
- Atomicidad: `createWithinLimits` comprueba (mismo libro, cupo, ejemplares) y crea en una sola operación; `markReturned` rechaza una segunda devolución dentro de la misma operación.
- Revisión de `security`: sin críticos ni altos; el medio (devolución doble) y B1, B2 y B6 quedaron corregidos.

**Archivos:**
- `app/features/loans/{schema.ts,server/*}`, `app/features/container.ts`, `app/api/loans/**`, `app/api/members/[id]/overdue/route.ts`, `app/shared/schema.ts`.
- Pruebas: `app/features/loans/tests/*`, `app/shared/tests/id-schema.test.ts`, `tests/helpers/loans.ts` (incluye el primer patrón para probar rutas HTTP: `loan-routes.test.ts`).

**Cómo verificar:** `npm run check:full` → 568 pruebas en verde y build con las tres rutas nuevas.

**Decisiones:** las decisiones de la persona constan solo en `docs/specs/F5-F8-prestamos-fisicos.md` (sección «Preguntas abiertas (resueltas)» y encabezado de estado); aquí no se repiten.

**Pendiente / bloqueos:**
- Pruebas de atomicidad contra el emulador de Firestore (hoy solo en memoria).
- B3: un documento de `loans` corrupto se vería como 400 en vez de 500 (`toLoan` lanza `ZodError`).
- B4: ventana de milisegundos entre comprobar cuenta activa, libro y `copies` y crear el préstamo (fuera de la transacción).
- B5: un prestatario puede reservarse hasta su cupo sin ir a la biblioteca; revisar en la Ola 2 (autorregistro) junto con el límite de tasa.
- Pantallas F34 y F35 (spec aparte).

**Dudas de la especificación:**
- No se define qué pasa si `returnLoan` recibe un `now` anterior a `loaned_at`.
- Los mensajes de error no están fijados, así que las pruebas solo distinguen el orden de comprobaciones cuando cambia la clase de error.
