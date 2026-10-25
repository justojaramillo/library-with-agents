@AGENTS.md

## Específico de Claude Code
- Los subagentes están en `.claude/agents/` (backend, frontend, tests, security) y las skills en `.claude/skills/`. Tú, la sesión principal, eres el orquestador: sigue la skill `feature-workflow`.
- El bloqueo de carpetas prohibidas está en `.claude/settings.json` (permisos + hook `PreToolUse`); las reglas del guard viven en `.agents/guard/rules.ts`, compartidas con OpenCode (ADR-0006).
- Los servidores MCP (`context7`, `next-devtools`) están declarados en `.mcp.json` y habilitados en `.claude/settings.json`.

## Dónde quedamos (2026-10-25)
**Construido, desplegado en Vercel y probado por la persona:** F0 (capa compartida), F1–F2 (catálogo), F3–F4 (cuentas, cinco roles, ingreso con Firebase, administrador único), F33 (barra de navegación con sesión; «Cuentas» solo para personal). `npm run check:full` en verde (385 pruebas). Repositorio: `justojaramillo/library-with-agents`, rama `main`, último commit de código `0945202`. La persona confirmó que en móvil (360 px) se ve bien y que la barra muestra la sesión.

**Cómo trabajamos (FDD, `feature-workflow`):** spec en `docs/specs/` → la persona la aprueba → contrato (`schema.ts`, solo el orquestador) → delegar en paralelo por zonas (backend, frontend, tests; varios agentes del mismo tipo si tocan archivos distintos) → integrar con `npm run check:full` → `security` en solo lectura → nota en `docs/handoffs/` → commit y push → la persona prueba en Vercel. Para reconstruir desde cero: `docs/bootstrap.md` (la prueba en carpeta vacía ya llegó hasta F33 con los docs corregidos).

**Siguiente paso acordado:** Ola 1 de préstamos. Empezar escribiendo la spec de **F5 (prestar un libro físico)** con la skill `write-spec` para que la persona la apruebe; después F6–F8 y las pantallas F34–F35. Plan de paralelismo: 2 agentes de backend (servicio y reglas / repositorio y rutas) y 2 de frontend, con la tabla «Interfaz de módulos» fijada en la spec antes de delegar.

## Pendientes del proyecto (borra cada uno al cerrarlo; si surge uno nuevo, añádelo aquí)
Al empezar una sesión, recuérdale a la persona lo que siga abierto y pregunta por dónde quiere seguir.

### Decisiones de la persona
- [ ] **Revisar las rutas** (`/`, `/login`, `/cuentas`, `/api/…`; la lista esperada está al final de `docs/features.md`). La persona dijo que las revisará ella.
- [ ] Decidir si el **correo con espacios** se recorta (el contrato lo recorta) o se rechaza.
- [ ] Aprobar la spec de F5 cuando esté escrita (siguiente paso).

### Firebase y Vercel (ADR-0003, ADR-0007)
- [ ] Confirmar en la consola de Firebase que `firestore.rules` está publicada y que el registro desde el cliente está desactivado.
- [ ] Vercel Blob (store **privado**) conectado al proyecto: se usará desde F27.

### Verificación y calidad
- [ ] **Revisión visual** que falta: 768 y 1024 px de `/`, `/login` y `/cuentas` y de la barra (nombre largo con sesión, foco, teclado), y forzar un fallo para ver `app/error.tsx`. En 360 px la persona ya la dio por buena. Detalle en `docs/handoffs/F33-navegacion-y-pantallas-base.md`.
- [ ] **Seguridad, mejoras que quedan** (informes del agente `security`): límite de tasa y caché del catálogo público (la búsqueda lee todo Firestore y puede agotar la cuota de Spark), cabeceras de seguridad (CSP, `X-Frame-Options`, `Referrer-Policy`) en `next.config.ts`, conciliar identidades huérfanas de Authentication (`email-already-exists` sin cuenta), paginar `GET /api/members`, `handleError` registra el objeto de error completo en los 500, y decidir si las cuentas de mostrador reciben un enlace de restablecimiento en vez de una contraseña elegida por el personal.
- [ ] **Pruebas que faltan:** rutas HTTP (401/403 por rol, 400 con un rol no permitido, logout desde otro origen), repositorios de Firestore y la re-validación en `register`/`provision` con roles inventados. De F33: `readNavUser` (inactiva/inexistente → sin sesión) y que el HTML estático de `/` no contenga «Ingresar» ni «Cerrar sesión» tras el build; decidir si se filtran caracteres Unicode de control en el nombre.
- [ ] Repetir la **prueba de reconstrucción en una carpeta vacía** (`docs/bootstrap.md`) cuando haya más features, para ver si los docs siguen siendo suficientes.

### Próximas features
- [ ] **Ola 1:** specs y construcción de F5–F8 (préstamos con plazo por rol) y pantallas F34–F35. La spec de F5 debe reemplazar `LOAN_RULES.maxActiveLoansPerMember` por `maxActiveLoansByRole` (3, 3, 5, igual para físicos y digitales pero contados por separado) y añadir `maxRenewalsByRole` (2, 2, 3); y añadir `loans` al contenedor. Después Ola 2 (cuentas: autorregistro, docente, recuperar contraseña con Firebase) y Ola 3 (lector con Markdown en Vercel Blob). Faltan las specs de F5–F38.
