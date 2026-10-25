## Entrega: orquestador · F13 + F14 (bibliotecarios, desactivar y reactivar cuentas) y parte 2 de F37 (`/personal`)
**Hecho:**
- **F13:** `POST /api/staff` (solo administrador) crea una cuenta `BIBLIOTECARIO` activa; el rol lo fija el servicio y se ignora cualquier `role` del cuerpo. `GET /api/staff` lista el personal (administrador y bibliotecarios, hasta 200, orden por nombre en español).
- **F14:** `PATCH /api/members/:id/active` con `{ active }`. Matriz: el bibliotecario cambia el estado de externos, estudiantes y docentes; el administrador, además, el de bibliotecarios; nadie el del administrador ni el propio. Idempotente. Orden de comprobaciones: origen → sesión → personal → validación → 404 → matriz; un prestatario recibe 403 antes de mirar el `:id` o el cuerpo.
- **Pantallas:** `/personal` (solo administrador: formulario «Crear bibliotecario» y lista del personal con estado) y, en `/cuentas`, el estado («Activa»/«Inactiva») y los botones «Desactivar» (dos pasos) y «Reactivar» (un clic) donde la matriz lo permite. La barra muestra «Personal» solo al administrador.
- Revisión de `security`: **Aprobado**, sin críticos, altos ni medios.

**Archivos:** contrato en `app/features/accounts/schema.ts`; backend en `app/features/accounts/server/{staff-service,repository,repository.memory,repository.firestore,member-paging}.ts`, `app/features/container.ts`, `app/api/staff/route.ts`, `app/api/members/[id]/active/route.ts`; frontend en `app/personal/page.tsx`, `app/cuentas/page.tsx`, `app/features/accounts/ui/{staff-form,staff-list,active-toggle,active-rules,active-state,account-list,nav-bar}`; pruebas en `app/features/accounts/tests/{staff-*,member-active-route,active-*,account-list-active,accounts-page-active,nav-bar-personal}.test.ts` y `tests/helpers/{staff,staff-screens}.ts`; cuatro dobles de `MemberRepository` de pruebas existentes recibieron los métodos nuevos.

**Cómo verificar:** `npm run check:full` → 3218 pruebas en verde y build con `/personal` y `/api/staff`.

**Decisiones:** constan solo en `docs/specs/F13-F14-bibliotecarios-y-desactivar-cuentas.md`.

**Pendiente / bloqueos:**
- **Probar en Vercel:** crear un bibliotecario desde `/personal`; ingresar con él; con el administrador desactivarlo y comprobar que **pierde la sesión en su siguiente petición** y que no puede ingresar; reactivarlo; comprobar que un bibliotecario no ve «Personal» ni botones sobre otro personal; desactivar y reactivar un estudiante desde `/cuentas`.
- **Revisión visual** de `/personal` y de `/cuentas` con botones a 360, 768 y 1024 px, y de los pasos interactivos (desactivar en dos pasos, foco en «Cancelar», formulario): sin pruebas de navegador.
- **De `security` (Bajos, sin cambio de código ahora):**
  - Sin límite de tasa en `POST /api/staff` ni en el `PATCH` (solo los usa el personal; cada alta llama a Firebase).
  - **Desactivar no revoca los tokens de refresco de Firebase:** si la cuenta se reactiva antes de que venza la cookie de sesión (8 h), esa cookie vieja vuelve a valer. Revocar al desactivar exigiría un método nuevo en `IdentityProvider` y entra en la spec.
  - `listByRoles` corta de forma arbitraria si hay más de 200 cuentas de personal y `/personal` no avisa del corte.
  - La matriz se evalúa con una lectura fuera de la transacción de `setActive`; hoy no es explotable (ninguna ruta cambia roles de personal), pero hay que moverla dentro si algún día se pueden cambiar.
  - Tipo `RawCreateStaffInput` declara `role?: string` (código muerto engañoso).
- **Sin cubrir:** el repositorio de Firestore (`setActive`, `listByRoles`, emulador), los flujos interactivos de `ActiveToggle` y `StaffForm`, y que el contenedor exponga exactamente tres métodos en `staff`.
- **Sigue abierto** el pendiente de las cuentas de mostrador (contraseña elegida por el personal, F36) y el filtro de caracteres ocultos en el nombre de la cuenta.

**Dudas de la especificación:** dos cambios opuestos simultáneos devuelven 200 ambos, cada respuesta con el estado que esa petición vio (la spec se ajustó a ese comportamiento).
