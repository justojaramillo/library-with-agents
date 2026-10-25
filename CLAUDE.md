@AGENTS.md

## Específico de Claude Code
- Los subagentes están en `.claude/agents/` (backend, frontend, tests, security) y las skills en `.claude/skills/`. Tú, la sesión principal, eres el orquestador: sigue la skill `feature-workflow`.
- El bloqueo de carpetas prohibidas está en `.claude/settings.json` (permisos + hook `PreToolUse`); las reglas del guard viven en `.agents/guard/rules.ts`, compartidas con OpenCode (ADR-0006).
- Los servidores MCP (`context7`, `next-devtools`) están declarados en `.mcp.json` y habilitados en `.claude/settings.json`.

## Dónde quedamos (2026-10-26)
**Construido, desplegado en Vercel y probado por la persona:** F0 (capa compartida), F1–F2 (catálogo), F3–F4 (cuentas, cinco roles, ingreso con Firebase, administrador único), F33 (barra de navegación con sesión; «Cuentas» solo para personal). `npm run check:full` en verde (894 pruebas). Repositorio: `justojaramillo/library-with-agents`, rama `main`, último commit de código `0945202`. La persona confirmó que en móvil (360 px) se ve bien y que la barra muestra la sesión.

**Cómo trabajamos (FDD, `feature-workflow`):** spec en `docs/specs/` → la persona la aprueba → contrato (`schema.ts`, solo el orquestador) → delegar en paralelo por zonas (backend, frontend, tests; varios agentes del mismo tipo si tocan archivos distintos) → integrar con `npm run check:full` → `security` en solo lectura → nota en `docs/handoffs/` → commit y push → la persona prueba en Vercel. Para reconstruir desde cero: `docs/bootstrap.md` (la prueba en carpeta vacía ya llegó hasta F33 con los docs corregidos).

**F5–F8 (préstamos físicos) construido** (spec `docs/specs/F5-F8-prestamos-fisicos.md` aprobada, revisión de `security` hecha, nota en `docs/handoffs/F5-F8-prestamos-fisicos.md`; `check:full` en verde, 568 pruebas). Falta la persona: probarlo cuando se despliegue.

**F34–F35 (pantallas de préstamos y búsqueda de personas) construido** (spec `docs/specs/F34-F35-pantallas-de-prestamos.md` aprobada, revisión de `security` aplicada, nota en `docs/handoffs/F34-F35-pantallas-de-prestamos.md`; `check:full` en verde, 894 pruebas). Con esto **termina la Ola 1**. La persona debe probarlo en Vercel y ejecutar `npm run backfill:members` (primero sin `--yes`).

**Siguiente paso:** elegir la Ola 2 (cuentas: F10 autorregistro, F11–F12 docente, F13 bibliotecarios, F14–F17) o cerrar F26 (guardar y pagar multas) para dejar completo el bloqueo por deuda. Escribir la spec con `write-spec` y esperar su aprobación. Último commit de código: F34–F35 (aún sin push; F5–F8 tampoco).

## Pendientes del proyecto (borra cada uno al cerrarlo; si surge uno nuevo, añádelo aquí)
Al empezar una sesión, recuérdale a la persona lo que siga abierto y pregunta por dónde quiere seguir.

### Decisiones de la persona
- [ ] **Revisar las rutas** (`/`, `/login`, `/cuentas`, `/api/…`; la lista esperada está al final de `docs/features.md`). La persona dijo que las revisará ella.
- [ ] Decidir si el **correo con espacios** se recorta (el contrato lo recorta) o se rechaza.

### Firebase y Vercel (ADR-0003, ADR-0007)
- [ ] Confirmar en la consola de Firebase que `firestore.rules` está publicada y que el registro desde el cliente está desactivado.
- [ ] Vercel Blob (store **privado**) conectado al proyecto: se usará desde F27.

### Verificación y calidad
- [ ] **Revisión visual** que falta: 768 y 1024 px de `/`, `/login` y `/cuentas` y de la barra (nombre largo con sesión, foco, teclado), y forzar un fallo para ver `app/error.tsx`. En 360 px la persona ya la dio por buena. Detalle en `docs/handoffs/F33-navegacion-y-pantallas-base.md`.
- [ ] **Seguridad, mejoras que quedan** (informes del agente `security`): límite de tasa y caché del catálogo público (la búsqueda lee todo Firestore y puede agotar la cuota de Spark), cabeceras de seguridad (CSP, `X-Frame-Options`, `Referrer-Policy`) en `next.config.ts`, conciliar identidades huérfanas de Authentication (`email-already-exists` sin cuenta), paginar `GET /api/members`, `handleError` registra el objeto de error completo en los 500, y decidir si las cuentas de mostrador reciben un enlace de restablecimiento en vez de una contraseña elegida por el personal.
- [ ] **De F5–F8 (`docs/handoffs/F5-F8-prestamos-fisicos.md`):** prueba de atomicidad de `loans` contra el emulador de Firestore; B3 (documento corrupto → 400 en vez de 500); B4 (ventana entre comprobar cuenta/libro y crear el préstamo); B5 (reserva remota de ejemplares: revisar en la Ola 2 con el límite de tasa).
- [ ] **Pruebas que faltan:** rutas HTTP (401/403 por rol, 400 con un rol no permitido, logout desde otro origen), repositorios de Firestore y la re-validación en `register`/`provision` con roles inventados. De F33: `readNavUser` (inactiva/inexistente → sin sesión) y que el HTML estático de `/` no contenga «Ingresar» ni «Cerrar sesión» tras el build; decidir si se filtran caracteres Unicode de control en el nombre.
- [ ] Repetir la **prueba de reconstrucción en una carpeta vacía** (`docs/bootstrap.md`) cuando haya más features, para ver si los docs siguen siendo suficientes.

- [ ] **Semilla autónoma** (análisis del 2026-10-26): armar un kit/script que copie la lista completa de `docs/bootstrap.md §2` con un `CLAUDE.md` semilla (sin «Dónde quedamos») y `docs/handoffs/` solo con la plantilla; añadir `docs/build-plan.md` con el orden, el criterio de parada y el primer mensaje; hacer la spec F5–F8 autosuficiente (puertos completos de `LoanRepository`, `BookLookup`, `MemberLookup`, `FineStrategy`; `markReturned` atómico → `ConflictError`; `IdSchema` ≤ 128 sin «/»); regla en `feature-workflow`: todo hallazgo de `security` que cambie el comportamiento entra en la spec en el mismo commit; actualizar la tabla de `bootstrap.md` (paso 5); la prueba en carpeta vacía debe usar **otro proyecto de Firebase**.

- [ ] **De F34–F35 (`docs/handoffs/F34-F35-pantallas-de-prestamos.md`):** ejecutar `backfill:members` en el Firebase real; revisión visual de las tres pantallas a 360/768/1024 px; límite de tasa en la búsqueda de personas; paginar `/prestamos`; aviso de lectura truncada (>200 coincidencias); recalcular `search_keys` al editar nombre o correo (F13 o similar); pruebas de navegador para lo interactivo.

### Próximas features
- [ ] **Ola 2** (siguiente) (cuentas: autorregistro, docente, recuperar contraseña con Firebase) y Ola 3 (lector con Markdown en Vercel Blob). Faltan las specs de F9–F32 y F36–F38.
