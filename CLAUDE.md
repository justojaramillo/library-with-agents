@AGENTS.md

## Específico de Claude Code
- Los subagentes están en `.claude/agents/` (backend, frontend, tests, security) y las skills en `.claude/skills/`. Tú, la sesión principal, eres el orquestador: sigue la skill `feature-workflow`.
- El bloqueo de carpetas prohibidas está en `.claude/settings.json` (permisos + hook `PreToolUse`); las reglas del guard viven en `.agents/guard/rules.ts`, compartidas con OpenCode (ADR-0006).
- Los servidores MCP (`context7`, `next-devtools`) están declarados en `.mcp.json` y habilitados en `.claude/settings.json`.

## Dónde quedamos (2026-10-26)
**Construido, desplegado en Vercel y probado por la persona:** F0 (capa compartida), F1–F2 (catálogo), F3–F4 (cuentas, cinco roles, ingreso con Firebase, administrador único), F33 (barra de navegación con sesión; «Cuentas» solo para personal). `npm run check:full` en verde (1246 pruebas). Repositorio: `justojaramillo/library-with-agents`, rama `main`, último commit de código `0945202`. La persona confirmó que en móvil (360 px) se ve bien y que la barra muestra la sesión.

**Cómo trabajamos (FDD, `feature-workflow`):** spec en `docs/specs/` → la persona la aprueba → contrato (`schema.ts`, solo el orquestador) → delegar en paralelo por zonas (backend, frontend, tests; varios agentes del mismo tipo si tocan archivos distintos) → integrar con `npm run check:full` → `security` en solo lectura → nota en `docs/handoffs/` → commit y push → la persona prueba en Vercel. Para reconstruir desde cero: `docs/bootstrap.md` (la prueba en carpeta vacía ya llegó hasta F33 con los docs corregidos).

**F5–F8 (préstamos físicos) construido** (spec `docs/specs/F5-F8-prestamos-fisicos.md` aprobada, revisión de `security` hecha, nota en `docs/handoffs/F5-F8-prestamos-fisicos.md`; `check:full` en verde, 568 pruebas). Falta la persona: probarlo cuando se despliegue.

**F34–F35 (pantallas de préstamos y búsqueda de personas) construido** (spec `docs/specs/F34-F35-pantallas-de-prestamos.md` aprobada, revisión de `security` aplicada, nota en `docs/handoffs/F34-F35-pantallas-de-prestamos.md`; `check:full` en verde, 894 pruebas). Con esto **termina la Ola 1**. La persona debe probarlo en Vercel y ejecutar `npm run backfill:members` (primero sin `--yes`).

**S1 (endurecimiento de seguridad) construido** (spec `docs/specs/S1-endurecimiento-de-seguridad.md`, ADR-0008, nota en `docs/handoffs/S1-endurecimiento-de-seguridad.md`; `check:full` en verde): `await connection()` en todo lo que lee la sesión, límite de tasa en memoria, caché del catálogo, cabeceras y CSP, cuentas paginadas, scripts `reconcile:identities` y `backfill:members`, ingreso con Firebase sin ventanas emergentes.

**Vercel Blob está conectado** (store privado; `npm run check:env` valida `BLOB_READ_WRITE_TOKEN`; la persona tiene además el id del store en su archivo de entorno, que el código aún no declara: decidirlo en F27, ver ADR-0003). Los agentes no leen el archivo de entorno: el estado se comprueba con `npm run check:env`.

**Regla de orden (decisión de la persona, 2026-10-26):** se construye **en orden de olas** (Ola 2 → 3 → 4 → 5); solo se adelanta lo **estrictamente necesario** para la feature en curso (p. ej. una pieza de F26 si F24 la exige). F24 y F26 siguen en la Ola 4.

**Siguiente paso:** Ola 2, en orden: F10 (autorregistro) con F16 (recuperar contraseña) y F17 (límite de intentos de ingreso); luego F11–F12 (solicitud de docente), F13–F14 (bibliotecarios, desactivar), F15 (cambiar contraseña) y F36–F37 (pantallas). Escribir cada spec con `write-spec` y esperar su aprobación. Commits locales sin push: F5–F8, F34–F35 y S1.

## Pendientes del proyecto (borra cada uno al cerrarlo; si surge uno nuevo, añádelo aquí)
Al empezar una sesión, recuérdale a la persona lo que siga abierto y pregunta por dónde quiere seguir.

### Decisiones de la persona
- [ ] **Revisar las rutas** (`/`, `/login`, `/cuentas`, `/api/…`; la lista esperada está al final de `docs/features.md`). La persona dijo que las revisará ella.
- [ ] Decidir si el **correo con espacios** se recorta (el contrato lo recorta) o se rechaza.

### Firebase y Vercel (ADR-0003, ADR-0007)
- [ ] Confirmar en la consola de Firebase que `firestore.rules` está publicada y que el registro desde el cliente está desactivado.
- [ ] Tras desplegar: probar el **ingreso con la CSP activa** (idealmente también en un móvil o Safari; si falla, mirar la consola del navegador y `connect-src` en `next.config.ts`) y **medir la caché del catálogo** (contar las lecturas de Firestore con dos búsquedas iguales; ADR-0008, «Limitaciones conocidas»).

### Verificación y calidad
- [ ] **Revisión visual** que falta: 768 y 1024 px de `/`, `/login` y `/cuentas` y de la barra (nombre largo con sesión, foco, teclado), y forzar un fallo para ver `app/error.tsx`. En 360 px la persona ya la dio por buena. Detalle en `docs/handoffs/F33-navegacion-y-pantallas-base.md`.
- [ ] **Seguridad, lo que queda tras S1** (`docs/specs/S1-endurecimiento-de-seguridad.md`, «Fuera de alcance»): decidir si las cuentas de mostrador reciben un enlace de restablecimiento en vez de una contraseña elegida por el personal (Ola 2, con F16); límite de tasa **global** (necesita un almacén compartido; el actual es por instancia, ADR-0008); límite de intentos de ingreso (F17).
- [ ] **De F5–F8 (`docs/handoffs/F5-F8-prestamos-fisicos.md`):** prueba de atomicidad de `loans` contra el emulador de Firestore; B4 (ventana de milisegundos entre comprobar cuenta/libro y crear el préstamo; aceptada); B5 (reserva remota de ejemplares: revisar en la Ola 2 con el autorregistro).
- [ ] **Pruebas que faltan:** rutas HTTP (401/403 por rol, 400 con un rol no permitido, logout desde otro origen), repositorios de Firestore y la re-validación en `register`/`provision` con roles inventados. De F33: `readNavUser` (inactiva/inexistente → sin sesión) y que el HTML estático de `/` no contenga «Ingresar» ni «Cerrar sesión» tras el build; decidir si se filtran caracteres Unicode de control en el nombre.
- [ ] Repetir la **prueba de reconstrucción en una carpeta vacía** (`docs/bootstrap.md`) cuando haya más features, para ver si los docs siguen siendo suficientes.

- [ ] **Semilla autónoma** (análisis del 2026-10-26): armar un kit/script que copie la lista completa de `docs/bootstrap.md §2` con un `CLAUDE.md` semilla (sin «Dónde quedamos») y `docs/handoffs/` solo con la plantilla; añadir `docs/build-plan.md` con el orden, el criterio de parada y el primer mensaje; hacer la spec F5–F8 autosuficiente (puertos completos de `LoanRepository`, `BookLookup`, `MemberLookup`, `FineStrategy`; `markReturned` atómico → `ConflictError`; `IdSchema` ≤ 128 sin «/»); regla en `feature-workflow`: todo hallazgo de `security` que cambie el comportamiento entra en la spec en el mismo commit; actualizar la tabla de `bootstrap.md` (paso 5); la prueba en carpeta vacía debe usar **otro proyecto de Firebase**.

- [ ] **De F34–F35 (`docs/handoffs/F34-F35-pantallas-de-prestamos.md`):** ejecutar `backfill:members` en el Firebase real; revisión visual de las tres pantallas a 360/768/1024 px y de la paginación de `/cuentas`; paginar `/prestamos`; recalcular `search_keys` al editar nombre o correo (F13 o similar); pruebas de navegador para lo interactivo.

### Próximas features
- [ ] **Ola 2** (siguiente; cuentas: F10–F17 y F36–F37), luego Ola 3 (lector con Markdown en Vercel Blob: F27–F32 y F38), Ola 4 (F18–F22, F23, F24, F26) y Ola 5 opcional (F9, F25). Llevamos 12 de 39 features; faltan las specs de F9–F32 y F36–F38.
