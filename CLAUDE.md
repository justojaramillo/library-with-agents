@AGENTS.md

## Específico de Claude Code
- Los subagentes están en `.claude/agents/` (backend, frontend, tests, security) y las skills en `.claude/skills/`. Tú, la sesión principal, eres el orquestador: sigue la skill `feature-workflow`.
- El bloqueo de carpetas prohibidas está en `.claude/settings.json` (permisos + hook `PreToolUse`); las reglas del guard viven en `.agents/guard/rules.ts`, compartidas con OpenCode (ADR-0006).
- Los servidores MCP (`context7`, `next-devtools`) están declarados en `.mcp.json` y habilitados en `.claude/settings.json`.

## Pendientes del proyecto (borra cada uno al cerrarlo; si surge uno nuevo, añádelo aquí)
Al empezar una sesión, recuérdale a la persona lo que siga abierto y pregunta por dónde quiere seguir.

### Decisiones de la persona
- [ ] **Revisar las rutas** (`/`, `/login`, `/cuentas`, `/api/…`; la lista esperada está al final de `docs/features.md`). La persona dijo que las revisará ella.

### Firebase y Vercel (ADR-0003, ADR-0007)
- [ ] La persona ya ejecutó `npm run seed -- --yes` (los agentes no lo ejecutan). Falta que pruebe el ingreso en local y confirme que publicó `firestore.rules` y desactivó el registro desde el cliente.
- [ ] La persona conecta el repositorio de GitHub (`justojaramillo/library-with-agents`, rama `main`) a Vercel, crea el store **privado** de Vercel Blob, agrega las variables de Firebase en el proyecto y despliega (README → «Configurar los servicios»). Blob se usará desde F27.

### Verificación y calidad
- [ ] **Revisión visual** a 360, 768 y 1024 px de `/`, `/login` y `/cuentas` y de la nueva barra (nombre largo con sesión, foco, teclado), y forzar un fallo para ver `app/error.tsx` (ningún agente ha abierto un navegador). Detalle en `docs/handoffs/F33-navegacion-y-pantallas-base.md`.
- [ ] **Seguridad, mejoras que quedan** (informe del agente `security`): límite de tasa y caché del catálogo público (la búsqueda lee todo Firestore y puede agotar la cuota de Spark), cabeceras de seguridad (CSP, `X-Frame-Options`, `Referrer-Policy`) en `next.config.ts`, conciliar identidades huérfanas de Authentication (`email-already-exists` sin cuenta), paginar `GET /api/members`, y decidir si las cuentas de mostrador reciben un enlace de restablecimiento en vez de una contraseña elegida por el personal.
- [ ] **Pruebas que faltan:** rutas HTTP (401/403 por rol y 400 con un rol no permitido), las pruebas del repositorio de Firestore y de las rutas HTTP (sin red real), y la re-validación en `register`/`provision` con roles inventados.
- [ ] Pruebas automáticas pequeñas que dejó F33: `readNavUser` (inactiva/inexistente → sin sesión) y que el HTML estático de `/` no contenga «Ingresar» ni «Cerrar sesión» tras el build; y decidir si se filtran caracteres Unicode de control en el nombre.
- [ ] Decidir si el **correo con espacios** se recorta (el contrato lo recorta) o se rechaza.
- [ ] Hacer la **prueba real en un directorio vacío** siguiendo `docs/bootstrap.md` (única forma de saber dónde se atascan los agentes). Faltan además las specs de F5–F38 para el proyecto completo.

### Próximas features
- [ ] Ola 1 de `docs/features.md`: escribir las specs F5–F8 (skill `write-spec`; ya están las respuestas de cupos, renovaciones y préstamo digital) y construirlas. La spec de F5 debe reemplazar `LOAN_RULES.maxActiveLoansPerMember` por `maxActiveLoansByRole` (3, 3, 5, igual para físicos y digitales pero contados por separado) y añadir `maxRenewalsByRole` (2, 2, 3). Después, cuentas (Ola 2) y lector (Ola 3).
