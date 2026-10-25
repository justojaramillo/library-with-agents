## Entrega: orquestador · F34–F35 (pantallas de préstamos y búsqueda de personas)
**Hecho:**
- `/prestamos` (personal): prestar eligiendo persona y libro con un campo, el botón «Buscar» y una lista de sugerencias; lista de préstamos activos por vencimiento; devolver en dos pasos con aviso de multa.
- `/mis-prestamos` y `/mis-vencidos` (prestatario), solo lectura; barra de navegación con «Préstamos» (personal) y «Mis préstamos» / «Mis vencidos» (prestatario).
- Servicio: `listActive`, `listActiveByMember` (`ActiveLoan`).
- Búsqueda de personas: `GET /api/members?q=&limit=&lendable=` (solo personal), con `search_keys` en Firestore (máx. 200 documentos por búsqueda). `limit` en `GET /api/books`. Lectura por lote: `getMany` y `getSummaries` (sin disponibilidad).
- Fechas en la hora local del navegador (`LocalDate`: HTML inicial en `America/Bogota`, luego la zona del navegador).
- Script `npm run backfill:members` (con `--yes`, `--limit=N`, aviso de emulador, espera de 5 s).
- Error de desarrollo `randomBytes` en `/` (`partialPrefetching`): `await connection()` en `CatalogContent`; confirmado por la persona en el navegador.
- Revisión de `security`: sin críticos ni altos; M1 (lecturas de más en `/prestamos`), B2 (pares sustitutos), B5 (script), B6 y B7 corregidos.

**Archivos:**
- `app/prestamos/`, `app/mis-prestamos/`, `app/mis-vencidos/`, `app/borrower-rows.ts`, `app/page.tsx`.
- `app/features/loans/ui/*` (format, local-date, pickers, lend-form, active-loans-list, return-button, loan-card, loan-rows, api-client, search-picker), `app/features/accounts/ui/nav-bar.tsx`.
- `app/features/{loans,accounts,catalog}/server/*`, `app/api/members/route.ts`, `app/api/books/route.ts`, `scripts/backfill-member-search.ts`.
- Pruebas: `app/features/*/tests/*` (844 → 894 pruebas en total), `tests/helpers/loan-rows.ts`.

**Cómo verificar:** `npm run check:full` → 894 pruebas en verde y build con `/prestamos`, `/mis-prestamos` y `/mis-vencidos`.

**Decisiones:**
- El libro físico se presta en el mostrador; la reserva desde el catálogo será otra spec (F25).
- Se identifica a la persona por nombre o correo; cédula o código estudiantil, después.
- Props de componentes en camelCase; `LoanRow` en snake_case porque refleja el cable.

**Pendiente / bloqueos:**
- **La persona debe ejecutar `npm run backfill:members -- --yes` sobre su Firebase** (primero sin `--yes`). Con muchas cuentas, usar `--limit=N` por tandas dentro de la cuota de Spark (20 000 escrituras al día).
- Revisión visual a 360, 768 y 1024 px de las tres pantallas (nadie las abrió en un navegador); lo interactivo (Enter que busca sin enviar, «Escribe al menos 2 letras.», doble clic, Devolver → Confirmar → Cancelar, respuestas desordenadas) no tiene prueba automática porque no hay jsdom.
- Seguridad: límite de tasa en la búsqueda de personas (hasta 200 lecturas por búsqueda) y caché del catálogo público; aviso de «lectura truncada» cuando hay más de 200 coincidencias (B3); recalcular `search_keys` cuando exista la edición de cuentas (B8); `members.search/getMany` se exponen en el contenedor sin actor (B4: no usarlos en rutas sin `requireStaff`).
- `/prestamos` carga todos los préstamos activos sin paginar.
- `readDueAt` (lend-form) es privada y no tiene prueba.

**Dudas de la especificación:**
- No fija el formato de «Nombre (Rol)» en las tarjetas ni el texto del libro seleccionado.
- `longestQueryWord` no está en la «Interfaz de módulos».
