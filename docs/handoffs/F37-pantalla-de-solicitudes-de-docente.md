## Entrega: orquestador · F37 parte 1 (pantalla `/solicitudes`)
**Hecho:**
- **`/solicitudes`** (solo personal): lista de solicitudes de docente con tres enlaces de estado (Pendientes, Aprobadas, Rechazadas), paginación de 50 que conserva el estado, y tarjetas con nombre, correo, rol, fecha, nota completa (escapada, con saltos de línea) y estado del correo. Las pendientes tienen «Aprobar» (en dos pasos; deshabilitado, con la razón visible, si el correo no está verificado) y «Rechazar» (con motivo opcional de hasta 300 caracteres). Los éxitos y los 409 se muestran en un aviso global que sobrevive a la recarga de la lista; cualquier 409 recarga.
- **Barra:** enlace «Solicitudes» para bibliotecario y administrador, sin contador.
- **Contrato (regla 14):** `note` y `reason` rechazan caracteres de control (salvo el salto de línea), de ancho cero y marcas de dirección, con «No uses caracteres de control ni invisibles.». El mensaje viaja en `issues[].message` del 400; `readRequestErrorMessage` lo lee de ahí y lo usan la pantalla y el formulario de `/docente`.
- `account-pagination.tsx` generalizado (ruta base, parámetros extra y etiqueta) sin cambiar `/cuentas`.
- Revisión de `security`: **Aprobado**, sin críticos, altos ni medios.

**Archivos:** `app/solicitudes/page.tsx`, `app/features/accounts/ui/{teacher-request-list,teacher-request-actions,teacher-request-tabs,request-error}.ts(x)`, `teacher-request-form.tsx`, `account-pagination.tsx`, `nav-bar.tsx`, `app/features/accounts/schema.ts`; pruebas en `app/features/accounts/tests/teacher-request-screen-*.test.ts` y `teacher-request-hidden-characters.test.ts`, ayudantes en `tests/helpers/{request-items,html-text,render-page}.ts`.

**Cómo verificar:** `npm run check:full` → 2662 pruebas en verde y build con `/solicitudes`.

**Decisiones:** constan solo en `docs/specs/F37-pantalla-de-solicitudes-de-docente.md`.

**Pendiente / bloqueos:**
- **Probar en Vercel con dos cuentas:** aprobar y rechazar desde `/solicitudes`; ver el cambio en `/docente`; que un 409 (otra persona del personal se adelantó) recargue la lista; que un motivo con caracteres ocultos muestre el mensaje.
- **Revisión visual** de `/solicitudes` a 360, 768 y 1024 px, y de los pasos interactivos (aprobar en dos pasos, formulario de rechazo, contador, botones deshabilitados): sin pruebas de navegador (el proyecto no tiene jsdom ni testing-library).
- **De `security` (Bajos, opcionales):**
  - La lista de la regla 14 deja pasar otros invisibles o de dirección (U+061C, U+180E, U+034F, U+3164, U+FFA0, U+2800, U+FE00–FE0F, etiquetas U+E0000–E007F, espacios U+2000–200A): decidir si se amplía (hoy se mantiene la lista tal como está).
  - El nombre de la cuenta (`name`) no pasa por ese filtro y se muestra al personal (ya era así en `/cuentas`): aplicarlo en F13 o similar.
  - Un 403 por origen o por rol degradado se muestra como «Tu sesión terminó»; si falla `router.refresh()` tras una decisión, los botones de la tarjeta quedan bloqueados hasta recargar; `buildPageHref` no codifica las claves de `extraParams` (hoy son constantes).
- **Sin cubrir:** `postDecision` y el `fetch` (no exportados), `router.refresh()`, el enlace a `/login` por sesión caducada y un `after` que lance un error distinto de `ZodError`.
- **Parte 2 de F37 (`/personal`):** pendiente hasta que existan F13 y F14.

**Dudas de la especificación:** la regla 4 dice rol «Externo»/«Estudiante» y el código usa las etiquetas de `ROLE_LABELS` («Externo/a»…); un `after` repetido o vacío se ignora como primera página (la spec solo menciona `a/b`).
