@AGENTS.md

## Específico de Claude Code
- Los subagentes están en `.claude/agents/` (backend, frontend, tests, security) y las skills en `.claude/skills/`. Tú, la sesión principal, eres el orquestador: sigue la skill `feature-workflow`.
- El bloqueo de carpetas prohibidas está en `.claude/settings.json` (permisos + hook `PreToolUse`); las reglas del guard viven en `.agents/guard/rules.ts`, compartidas con OpenCode (ADR-0006).
- Los servidores MCP (`context7`, `next-devtools`) están declarados en `.mcp.json` y habilitados en `.claude/settings.json`.

## Dónde quedamos (2026-10-26)
**Construido, desplegado en Vercel y probado por la persona:** F0 (capa compartida), F1–F2 (catálogo), F3–F4 (cuentas, cinco roles, ingreso con Firebase, administrador único), F33 (barra de navegación con sesión; «Cuentas» solo para personal). `npm run check:full` en verde (1452 pruebas). Repositorio: `justojaramillo/library-with-agents`, rama `main`, último commit de código `0945202`. La persona confirmó que en móvil (360 px) se ve bien y que la barra muestra la sesión.

**Cómo trabajamos (FDD, `feature-workflow`):** spec en `docs/specs/` → la persona la aprueba → contrato (`schema.ts`, solo el orquestador) → delegar en paralelo por zonas (backend, frontend, tests; varios agentes del mismo tipo si tocan archivos distintos) → integrar con `npm run check:full` → `security` en solo lectura → nota en `docs/handoffs/` → commit y push → la persona prueba en Vercel. Para reconstruir desde cero: `docs/bootstrap.md` (la prueba en carpeta vacía ya llegó hasta F33 con los docs corregidos).

**F5–F8 (préstamos físicos) construido** (spec `docs/specs/F5-F8-prestamos-fisicos.md` aprobada, revisión de `security` hecha, nota en `docs/handoffs/F5-F8-prestamos-fisicos.md`; `check:full` en verde, 568 pruebas). Falta la persona: probarlo cuando se despliegue.

**F34–F35 (pantallas de préstamos y búsqueda de personas) construido** (spec `docs/specs/F34-F35-pantallas-de-prestamos.md` aprobada, revisión de `security` aplicada, nota en `docs/handoffs/F34-F35-pantallas-de-prestamos.md`; `check:full` en verde, 894 pruebas). Con esto **termina la Ola 1**. La persona debe probarlo en Vercel y ejecutar `npm run backfill:members` (primero sin `--yes`).

**S1 (endurecimiento de seguridad) construido** (spec `docs/specs/S1-endurecimiento-de-seguridad.md`, ADR-0008, nota en `docs/handoffs/S1-endurecimiento-de-seguridad.md`; `check:full` en verde): `await connection()` en todo lo que lee la sesión, límite de tasa en memoria, caché del catálogo, cabeceras y CSP, cuentas paginadas, scripts `reconcile:identities` y `backfill:members`, ingreso con Firebase sin ventanas emergentes.

**Vercel Blob está conectado** (store privado; `npm run check:env` valida `BLOB_READ_WRITE_TOKEN`; la persona tiene además el id del store en su archivo de entorno, que el código aún no declara: decidirlo en F27, ver ADR-0003). Los agentes no leen el archivo de entorno: el estado se comprueba con `npm run check:env`.

**Orden de construcción:** por olas (Ola 2 → 3 → 4 → 5, `docs/features.md`); solo se adelanta lo estrictamente necesario para la feature en curso (p. ej. una pieza de F26 si F24 la exige).

**F10 + F16 + F17 (autorregistro, recuperar contraseña, límite de intentos) construido** (spec `docs/specs/F10-F16-F17-autoservicio-de-cuentas.md`, nota en `docs/handoffs/F10-F16-F17-autoservicio-de-cuentas.md`; `check:full` en verde, 1452 pruebas, `security` sin críticos ni altos). Incluye el arreglo del aviso de eval de la CSP (Zod `jitless` vía `client-setup`).

**F11 + F12 (solicitud de docente y su aprobación) construido** (spec `docs/specs/F11-F12-solicitud-de-docente.md` aprobada, nota en `docs/handoffs/F11-F12-solicitud-de-docente.md`; `check:full` en verde, 1833 pruebas, `security` Aprobado sin críticos ni altos). El correo verificado se exige solo para pedir el rol de docente. Con esto F10, F16 y F17 ya están en `main`; F11–F12 está en commit local.

**Siguiente paso:** seguir la Ola 2 en orden: F13–F14 (bibliotecarios, desactivar cuentas), F15 (cambiar contraseña) y F36–F37 (pantallas, incluidas `/solicitudes` y `/personal`). Escribir cada spec con `write-spec` y esperar su aprobación. F5–F8, F34–F35, S1 y F10+F16+F17 ya están en `main`.

## Pendientes del proyecto (borra cada uno al cerrarlo; si surge uno nuevo, añádelo aquí)
Al empezar una sesión, recuérdale a la persona lo que siga abierto y pregunta por dónde quiere seguir.

### Decisiones de la persona
- [ ] **Revisar las rutas** (`/`, `/login`, `/cuentas`, `/api/…`; la lista esperada está al final de `docs/features.md`). La persona dijo que las revisará ella.
- [ ] Decidir si el **correo con espacios** se recorta (el contrato lo recorta) o se rechaza.

### Firebase y Vercel (ADR-0003, ADR-0007)
- [ ] Confirmar en la consola de Firebase que `firestore.rules` está publicada y que el registro desde el cliente está desactivado.
- [ ] **Consola de Firebase (F10):** confirmar «Email enumeration protection» y **desactivar «Enable create (sign-up)»** (la opción existe en la consola; sin desactivarla, el registro directo contra la API de Firebase evita nuestro límite; si exigió pasar a Identity Platform, revisar sus límites del plan gratuito), y luego probar `/registro` y `/login` para confirmar que el alta desde nuestro servidor sigue funcionando; revisar la plantilla «Restablecer contraseña» en español y los dominios autorizados. Después de desplegar F10: probar `/registro` (ingreso automático) y `/recuperar`, y que la consola del navegador no muestre el aviso de eval de la CSP.
- [ ] **Probar F11–F12 en Vercel:** el índice compuesto ya está creado y el listado del personal funciona; la solicitud se envía y se ve como pendiente. Falta probar aprobar y rechazar (por la API hasta que exista F37) y ver el cambio en `/docente` y en el plazo del siguiente préstamo.
- [ ] Tras desplegar: probar el **ingreso con la CSP activa** (idealmente también en un móvil o Safari; si falla, mirar la consola del navegador y `connect-src` en `next.config.ts`) y **medir la caché del catálogo** (contar las lecturas de Firestore con dos búsquedas iguales; ADR-0008, «Limitaciones conocidas»).

### Verificación y calidad
- [ ] **Revisión visual** que falta: 768 y 1024 px de `/`, `/login` y `/cuentas` y de la barra (nombre largo con sesión, foco, teclado), y forzar un fallo para ver `app/error.tsx`. En 360 px la persona ya la dio por buena. Detalle en `docs/handoffs/F33-navegacion-y-pantallas-base.md`.
- [ ] **Seguridad, lo que queda tras S1** (`docs/specs/S1-endurecimiento-de-seguridad.md`, «Fuera de alcance»): decidir si las cuentas de mostrador reciben un enlace de restablecimiento en vez de una contraseña elegida por el personal (Ola 2, con F16); límite de tasa **global** (necesita un almacén compartido; el actual es por instancia, ADR-0008); límite de intentos de ingreso (F17).
- [ ] **De F5–F8 (`docs/handoffs/F5-F8-prestamos-fisicos.md`):** prueba de atomicidad de `loans` contra el emulador de Firestore; B4 (ventana de milisegundos entre comprobar cuenta/libro y crear el préstamo; aceptada); B5 (reserva remota de ejemplares: revisar en la Ola 2 con el autorregistro).
- [ ] **Pruebas que faltan:** rutas HTTP (401/403 por rol, 400 con un rol no permitido, logout desde otro origen), repositorios de Firestore y la re-validación en `register`/`provision` con roles inventados. De F33: `readNavUser` (inactiva/inexistente → sin sesión) y que el HTML estático de `/` no contenga «Ingresar» ni «Cerrar sesión» tras el build; decidir si se filtran caracteres Unicode de control en el nombre.
- [ ] Repetir la **prueba de reconstrucción en una carpeta vacía** (`docs/bootstrap.md`) cuando haya más features, para ver si los docs siguen siendo suficientes.

- [ ] **Semilla para estudiantes — las specs no deben viajar** (revisión del 2026-10-26): hoy `docs/bootstrap.md` §2 copia `docs/` completo (incluye `docs/specs/` aprobadas y `docs/handoffs/`) y §3 manda empezar por la spec F0 ya escrita; la fila de F0 de `docs/features.md` solo apunta a esa spec. Para que el estudiante escriba y apruebe cada spec: en el kit dejar solo `docs/specs/_template.md` y `docs/handoffs/_plantilla.md`, cambiar el primer mensaje a «escribe la spec de F0 con `write-spec`», describir F0 dentro de `features.md`, y decidir qué hacer con los ADR (todos «Aceptada»), los contratos `schema.ts` (fijan plazos, cupos y roles) y las reglas de negocio de `features.md`, que también son decisiones ya tomadas.
- [ ] **Semilla autónoma** (análisis del 2026-10-26): armar un kit/script que copie la lista completa de `docs/bootstrap.md §2` con un `CLAUDE.md` semilla (sin «Dónde quedamos») y `docs/handoffs/` solo con la plantilla; añadir `docs/build-plan.md` con el orden, el criterio de parada y el primer mensaje; hacer la spec F5–F8 autosuficiente (puertos completos de `LoanRepository`, `BookLookup`, `MemberLookup`, `FineStrategy`; `markReturned` atómico → `ConflictError`; `IdSchema` ≤ 128 sin «/»); regla en `feature-workflow`: todo hallazgo de `security` que cambie el comportamiento entra en la spec en el mismo commit; actualizar la tabla de `bootstrap.md` (paso 5); la prueba en carpeta vacía debe usar **otro proyecto de Firebase**.

- [ ] **De F11–F12 (`docs/handoffs/F11-F12-solicitud-de-docente.md`):** antes de cualquier «cambiar correo», comprobar que el correo verificado en Firebase es el de `members.email`; antes de F37, filtrar caracteres Unicode de control/ancho cero/bidi en `note` y `reason`; revisión visual de `/docente` a 360/768/1024 px; pruebas del adaptador `identity.firebase.ts` y del repositorio Firestore de solicitudes (emulador).
- [ ] **De F34–F35 (`docs/handoffs/F34-F35-pantallas-de-prestamos.md`):** ejecutar `backfill:members` en el Firebase real; revisión visual de las tres pantallas a 360/768/1024 px y de la paginación de `/cuentas`; paginar `/prestamos`; recalcular `search_keys` al editar nombre o correo (F13 o similar); pruebas de navegador para lo interactivo.

### Próximas features
- [ ] **Ola 2** (siguiente; cuentas: F10–F17 y F36–F37), luego Ola 3 (lector con Markdown en Vercel Blob: F27–F32 y F38), Ola 4 (F18–F22, F23, F24, F26) y Ola 5 opcional (F9, F25). Llevamos 17 de 39 features (con F10–F12, F16 y F17); faltan las specs de F9, F13–F15, F18–F32 y F36–F38.
