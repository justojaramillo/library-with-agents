# F13 · F14 · Crear bibliotecarios y desactivar o reactivar cuentas (con la pantalla `/personal`)

- **Estado:** Aprobada (la persona aprobó la spec con las propuestas de las cinco preguntas, 2026-10-25)
- **Rol(es):** F13: `ADMINISTRADOR` · F14: `BIBLIOTECARIO` y `ADMINISTRADOR`, con límites (regla 5 de `docs/features.md`)
- **Contrato afectado:** `app/features/accounts/schema.ts` (`CreateStaffInputSchema`, `SetMemberActiveInputSchema`); `app/shared/schema.ts` no cambia.
- **Depende de:** `docs/specs/F3-F4-roles-y-cuentas.md`, `docs/specs/S1-endurecimiento-de-seguridad.md` y `docs/specs/F37-pantalla-de-solicitudes-de-docente.md` (aprobadas); ADR-0004 (roles).
- **Incluye la parte 2 de F37:** la pantalla `/personal`. Los formularios para registrar cuentas de mostrador (`/cuentas/nuevo`, F36) quedan fuera.
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA, Cache Components).

## Objetivo
El administrador crea cuentas de bibliotecario (F13), y el personal desactiva y reactiva cuentas dentro de sus límites (F14), desde pantallas y sin llamar a la API a mano.

## Qué hay hoy y qué cambia
- `MemberService.provision` (cualquier rol) existe, pero solo lo alcanzan los scripts (`seed`): `getContainer().admin.provision`, que ninguna ruta usa. `register` (F3/F10) solo admite `EXTERNO` y `ESTUDIANTE`.
- El campo `active` de `members/{uid}` ya existe y ya se respeta: una cuenta inactiva no ingresa (F4, «Credenciales inválidas»), su sesión deja de valer en la **siguiente petición** (el resolvedor lee la cuenta en cada petición) y no puede pedir prestado (F5). No hay forma de cambiarlo por la web.
- No existe un listado filtrado por rol. `GET /api/members` lista todas las cuentas con paginación.
- La barra del personal tiene «Préstamos», «Solicitudes» y «Cuentas».

## Reglas de negocio

### F13 · Crear una cuenta de bibliotecario
1. **`POST /api/staff`** (solo `ADMINISTRADOR`) recibe `{ name, email, password }` (mismos límites que el registro: nombre recortado de 1 a 120, correo válido de hasta 254 en minúsculas, contraseña de 8 a 100). **El rol no viene en el cuerpo:** la cuenta siempre se crea como `BIBLIOTECARIO`, activa; un campo `role` (o cualquier otro) en el cuerpo se ignora. Respuesta **201** con el `Member` público.
2. **Orden de comprobaciones:** `assertSameOrigin` → sesión (401) → rol (`BIBLIOTECARIO` → **403** «Solo el administrador crea bibliotecarios.») → validación (400) → alta. La autorización va antes que la validación.
3. Correo ya registrado → **409** «Ya existe una cuenta con ese correo.» (el mismo mensaje de F10). El alta es la de `createAccount` (identidad en Firebase y documento en Firestore; si falla guardar, se borra la identidad). Reutiliza `provision`, que no se expone a ninguna ruta por sí mismo: el servicio nuevo `staff.create(actor, input)` comprueba al actor y fija el rol.
4. **Contraseña:** la elige el administrador (como en el mostrador, F3); la persona puede cambiarla (F15) o recuperarla (F16). El correo de la cuenta de personal queda sin verificar en Firebase y no lo necesita (la verificación solo se exige para pedir el rol de docente).
5. **Nadie más crea personal:** `POST /api/members` (F3) sigue rechazando con 400 cualquier rol de personal o `DOCENTE`; no hay ruta para crear administradores (el único lo crea el `seed`).

### F14 · Desactivar y reactivar una cuenta
6. **`PATCH /api/members/:id/active`** (personal) recibe `{ active: boolean }` y devuelve **200** con el `Member` actualizado. `:id` se valida con `IdSchema`.
7. **Quién puede cambiar a quién** (por el rol de la cuenta destino):

   | Actor ↓ / Destino → | `EXTERNO` · `ESTUDIANTE` · `DOCENTE` | `BIBLIOTECARIO` | `ADMINISTRADOR` | Sí mismo |
   | --- | --- | --- | --- | --- |
   | `BIBLIOTECARIO` | sí | **403** | **403** | **403** |
   | `ADMINISTRADOR` | sí | sí | **403** | **403** |

   Mensajes: bibliotecario sobre personal → «Un bibliotecario no puede cambiar el estado de otro personal.»; cualquiera sobre el administrador → «El administrador no se puede desactivar.»; sobre sí mismo → «No puedes cambiar el estado de tu propia cuenta.». Un prestatario → 403 «Solo para personal de la biblioteca»; sin sesión → 401. **Prioridad cuando se cumplen varias:** primero «destino administrador» (incluye al administrador sobre sí mismo), después «sobre sí mismo» (un bibliotecario sobre sí mismo) y por último «bibliotecario sobre otro personal».
8. **Orden de comprobaciones:** origen → sesión → personal → validación del `:id` y del cuerpo (400) → cuenta destino inexistente (**404**) → matriz de la regla 7 (403). Un prestatario recibe 403 aunque el `:id` o el cuerpo sean inválidos.
9. **Idempotente:** pedir el estado que la cuenta ya tiene devuelve 200 con la cuenta, sin escribir ni fallar.
10. **Efectos** (ya existen; esta feature solo los dispara): la persona desactivada no puede ingresar ni pedir prestado, y su sesión abierta deja de valer en su siguiente petición; sus préstamos activos **siguen abiertos y el personal puede recibirlos** (F6; pregunta 1); una solicitud de docente pendiente sigue pendiente, pero aprobarla falla con 409 «La cuenta ya no puede recibir el rol de docente.» (F12). Reactivar devuelve el acceso con el mismo rol; no rehace nada más.
11. **Cómo se escribe:** una actualización del campo `active` de `members/{id}`, validada con Zod; no toca otros campos (ni `search_keys`). Si el rol cambió entre la comprobación y la escritura (p. ej. se aprobó como docente), no importa: la matriz solo distingue personal de prestatario y el rol de personal no cambia por la web.

### Listado de personal y pantallas
12. **`GET /api/staff`** (solo `ADMINISTRADOR`) devuelve las cuentas con rol `BIBLIOTECARIO` o `ADMINISTRADOR`, ordenadas por nombre y luego por id, hasta **200**. Es una consulta por `role in [...]` sin orden en Firestore (no necesita índice compuesto) y se ordena en el servidor.
13. **`/personal`** (solo `ADMINISTRADOR`): sin sesión → `/login`; cualquier otro rol → «Solo para el administrador.» (`role="alert"`). `<h1>` «Personal». Contiene:
    - una sección «Crear bibliotecario» con un formulario (nombre, correo, contraseña con ayuda «Entre 8 y 100 caracteres»; el botón «Crear bibliotecario» se deshabilita mientras envía). Éxito → «Se creó la cuenta de {Nombre}.» en `role="status"`, el formulario se limpia y la lista se recarga. Errores: el mensaje del servidor (409, 403); un 400 de validación → «Revisa los datos del formulario.»; red → «No se pudo crear la cuenta»;
    - una sección «Personal» con la lista de `<article>`: nombre, correo, rol («Bibliotecario/a» o «Administrador/a»), estado («Activa» o «Inactiva», con icono y texto) y, para los bibliotecarios, el botón de la regla 15. El administrador aparece sin botón.
14. **Barra:** «Personal» solo para el administrador (`StaffLinks`); el bibliotecario no lo ve.
15. **Botones de estado** (en `/personal` y en cada cuenta de `/cuentas`): la pantalla solo ofrece el botón cuando la matriz de la regla 7 lo permite para el rol del actor (el servidor es la barrera real). «Desactivar» es de **dos pasos** («Confirmar desactivación» + «Cancelar»); «Reactivar» es de un clic (pregunta 2). Éxito → aviso global «{Nombre} ahora está inactiva/activa.» y la lista se recarga; error → su mensaje en la tarjeta (`role="alert"`); 401 → «Tu sesión terminó. Vuelve a ingresar.» con enlace a `/login`; 403 → el mensaje del servidor (los de la matriz de la regla 7); red → «No se pudo completar la acción». Sin doble envío.
16. **`/cuentas`** pasa a mostrar el estado («Activa»/«Inactiva») de cada cuenta si hoy no lo muestra, y añade los botones de la regla 15. Su paginación no cambia. Las cuentas inactivas no se ocultan.

## Entradas y salidas
| Operación | Entrada | Salida |
| --- | --- | --- |
| `POST /api/staff` | `CreateStaffInput` `{ name, email, password }` | 201 `Member` · 400 · 401 · 403 · 409 |
| `GET /api/staff` | — | 200 `Member[]` (hasta 200) · 401 · 403 |
| `PATCH /api/members/:id/active` | `SetMemberActiveInput` `{ active }` | 200 `Member` · 400 · 401 · 403 · 404 |
| `/personal` | sesión de administrador | formulario y lista |

Errores esperados (clase → cuándo): `UnauthorizedError` sin sesión · `ForbiddenError` rol insuficiente o destino no permitido · `NotFoundError` cuenta destino inexistente · `ConflictError` correo repetido · `ZodError` → 400 · origen distinto → 403.

## Autorización
- **F13 (crear y listar personal):** solo `ADMINISTRADOR` activo. Un bibliotecario recibe 403; un prestatario, 403; sin sesión, 401.
- **F14:** `BIBLIOTECARIO` y `ADMINISTRADOR` activos, según la matriz de la regla 7. Prestatarios: 403.
- La identidad del actor sale siempre de la sesión; el `:id` es el único dato del cliente que elige a quién se afecta y se valida antes de usarse.

## Criterios de aceptación
- **Dado** el administrador, **cuando** envía `POST /api/staff` con nombre, correo y contraseña válidos, **entonces** 201 y la cuenta es `BIBLIOTECARIO`, activa; puede ingresar.
- **Dado** `role: "ADMINISTRADOR"` (o `"DOCENTE"`, `"EXTERNO"`) en el cuerpo, **entonces** se ignora y la cuenta sigue siendo `BIBLIOTECARIO`.
- **Dado** un bibliotecario o un prestatario, **cuando** llama a `POST /api/staff` o `GET /api/staff`, **entonces** 403 aunque el cuerpo sea inválido; sin sesión, 401; con otro origen, 403.
- **Dado** un correo ya registrado (también con otras mayúsculas), **entonces** 409 y no se crea una segunda cuenta; **dado** una contraseña de 7 caracteres, **entonces** 400; de 8 y de 100, 201; de 101, 400.
- **Dado** que guardar el documento falla, **entonces** la identidad se borra y el correo puede volver a usarse.
- **Dado** un bibliotecario, **cuando** desactiva a un `ESTUDIANTE`, **entonces** 200, la cuenta queda inactiva, no puede ingresar y su sesión abierta recibe 401 en la siguiente petición.
- **Dado** un bibliotecario, **cuando** intenta desactivar a otro bibliotecario, al administrador o a sí mismo, **entonces** 403 con el mensaje de la regla 7 y nada cambia.
- **Dado** el administrador, **cuando** desactiva a un bibliotecario, **entonces** 200; **cuando** intenta desactivarse o desactivar al administrador, **entonces** 403.
- **Dado** una cuenta inactiva, **cuando** el personal permitido la reactiva, **entonces** 200 y la persona vuelve a ingresar con el mismo rol.
- **Dado** el estado que la cuenta ya tiene, **entonces** 200 sin cambios (idempotente).
- **Dado** un `:id` inexistente, **entonces** 404; con `:id` mal formado (`a/b`) o cuerpo sin `active` booleano, **entonces** 400; un prestatario recibe 403 en ambos casos.
- **Dado** una persona desactivada con un préstamo abierto, **entonces** el personal puede devolverlo (F6) y no puede prestarle nada más (F5).
- **Dado** una solicitud de docente pendiente de una cuenta desactivada, **cuando** se aprueba, **entonces** 409 y sigue pendiente.
- **Dado** el administrador en `/personal`, **entonces** ve el formulario y la lista de personal con estado; **dado** un bibliotecario, **entonces** ve «Solo para el administrador.» y la barra no muestra «Personal».
- **Dado** `/cuentas`, **entonces** cada cuenta muestra «Activa»/«Inactiva» y los botones solo aparecen donde la matriz lo permite para el rol del actor.
- **Dado** `/personal` y `/cuentas` a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, los botones miden al menos 44 px y todo se usa con teclado.

## Bordes
- `POST /api/staff`: nombre de 1, 120 y 121 caracteres, solo espacios; correo con mayúsculas y espacios, de 254 y 255 caracteres; contraseña de 7, 8, 100 y 101; cuerpo vacío o que no es JSON; doble envío del formulario; dos altas simultáneas con el mismo correo (una 201 y otra 409).
- `PATCH`: `active` ausente, `null`, `"true"` (cadena), `true`, `false`; cuerpo vacío; `:id` de 128 y 129 caracteres, con «/» y reservado (`.`, `__x__`); cuenta destino sin documento; dos cambios simultáneos opuestos (ambos 200; gana uno de los dos y cada respuesta refleja el estado que esa petición vio; la pantalla se recarga y muestra el real).
- Estado: desactivar a quien tiene préstamos vencidos, a quien tiene una solicitud pendiente y a un `DOCENTE`; reactivar una cuenta que nunca se desactivó.
- Listado de personal: 0 bibliotecarios (solo el administrador), 1, 200 y más de 200 (se corta en 200).
- Sesión: el actor se desactiva a mitad de la acción (401); el administrador activo que cambia su propio estado (403).

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `accounts/schema.ts` | orquestador | `CreateStaffInputSchema = MemberBase sin rol: { name, email, password }`; `SetMemberActiveInputSchema = { active: z.boolean() }` y sus tipos |
| `accounts/server/repository.ts` (+ `.memory`, `.firestore`) | backend | `setActive(id, active): Promise<MemberRecord \| undefined>` (actualiza solo `active`; `undefined` si no existe) y `listByRoles(roles: Role[], limit: number): Promise<MemberRecord[]>` (sin orden en Firestore, orden por nombre e id en memoria igual que en el servicio) |
| `accounts/server/staff-service.ts` | backend | `createStaffService({ members, provision })` → `create(actor, input): Promise<Member>` (reglas 1–5), `list(actor): Promise<Member[]>` (regla 12), `setActive(actor, id, active): Promise<Member>` (reglas 6–11, con la matriz como función pura `canChangeActive(actorRole, actorId, target)` exportada) |
| `container.ts` | backend | Conectar `staff` (expone solo esos tres métodos; `provision` sigue sin ser alcanzable desde las rutas) |
| `app/api/staff/route.ts` · `app/api/members/[id]/active/route.ts` | backend | `POST`/`GET` y `PATCH` según las reglas 1–12 |
| `app/personal/page.tsx` · `accounts/ui/staff-form.tsx` · `accounts/ui/staff-list.tsx` | frontend | Reglas 13 y 15 |
| `accounts/ui/active-toggle.tsx` (cliente) | frontend | Regla 15; función pura `canShowToggle(actorRole, actorId, target)` (misma matriz de la regla 7, solo para mostrar u ocultar) y `messageForToggleError<T>(error)` |
| `accounts/ui/account-list.tsx` · `app/cuentas/page.tsx` | frontend | Regla 16; recibe el actor para decidir qué botones mostrar |
| `accounts/ui/nav-bar.tsx` | frontend | «Personal» solo para el administrador |
| Pruebas | tests | Matriz de la regla 7 completa (actor × destino), idempotencia, 404/400/403 y su orden, el efecto sobre ingreso, sesión y préstamos, alta de bibliotecario con rol ignorado, atomicidad del alta, rutas HTTP, render de `/personal` y `/cuentas`, `canShowToggle`, y que `POST /api/members` siga rechazando roles de personal |

Reparto sugerido: orquestador fija `schema.ts` → **backend** (repositorios, servicio, rutas, contenedor) ∥ **frontend** (pantallas) ∥ **tests** del backend → pruebas de pantallas con los nombres reales → `npm run check:full` → `security` → handoff.

## Fuera de alcance
Formularios para registrar cuentas de mostrador (`/cuentas/nuevo`, F36), cambiar el rol de una cuenta, borrar cuentas, quitar el rol de docente, cambiar el nombre o el correo, cambiar o restablecer la contraseña de otra persona (F15/F16 son de la propia persona), registrar quién y cuándo desactivó (pregunta 4), forzar el cierre de sesiones ya emitidas más allá de lo que ya hace el resolvedor, y paginar el listado de personal más allá de 200.

## Preguntas abiertas (resueltas)
La persona aprobó la spec con la propuesta de cada una:
1. **Desactivar a quien tiene préstamos activos** (regla 10): se permite; sus préstamos siguen abiertos y se pueden devolver.
2. **Reactivar** (regla 15): de un clic; desactivar lleva dos pasos.
3. **Contraseña del bibliotecario** (regla 4): la elige el administrador al crear la cuenta.
4. **Registro de quién desactivó y cuándo:** no se guarda en esta feature.
5. **Pantallas** (reglas 13–16): `/personal` solo para el administrador; los botones de estado de los prestatarios, dentro de `/cuentas`.
