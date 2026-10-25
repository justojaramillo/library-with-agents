# F37 (parte 1) · Pantalla `/solicitudes`: ver, aprobar y rechazar solicitudes de docente

- **Estado:** Aprobada (la persona aceptó las propuestas de las seis preguntas y aprobó, 2026-10-25)
- **Rol(es):** personal (`BIBLIOTECARIO`, `ADMINISTRADOR`)
- **Contrato afectado:** `app/features/accounts/schema.ts` (`CreateTeacherRequestInputSchema` y `RejectTeacherRequestInputSchema` rechazan caracteres invisibles o de control, regla 14). La API de F11–F12 no cambia. `app/shared/schema.ts` no cambia.
- **Depende de:** `docs/specs/F11-F12-solicitud-de-docente.md` (aprobada; aquí solo se construye su pantalla), `docs/specs/F33-navegacion-y-pantallas-base.md` y `docs/specs/F34-F35-pantallas-de-prestamos.md` (patrones de pantalla de personal).
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA, Cache Components).
- **Parte 2 de F37 (fuera de esta spec):** `/personal` (gestión de bibliotecarios), que depende de F13 y F14.

## Objetivo
El personal de la biblioteca ve las solicitudes del rol de docente y las aprueba o rechaza desde una pantalla, sin llamar a la API a mano.

## Qué hay hoy y qué cambia
- La API ya existe y está probada: `GET /api/teacher-requests?status=&limit=&after=`, `POST /api/teacher-requests/:id/approve` y `POST /api/teacher-requests/:id/reject` (F11–F12). Cada elemento del listado trae `member_name`, `member_email`, `member_role`, `email_verified`, `note`, `status`, `requested_at`, `decided_at`, `decided_by` y `reason`.
- La lista se lee en el servidor con el contenedor (`getContainer().teacherRequests.list`), igual que `/cuentas`; las acciones usan las rutas HTTP, desde un componente de cliente, igual que `/prestamos`.
- La barra de navegación del personal tiene «Préstamos» y «Cuentas»; hay que añadir «Solicitudes».
- `security` pidió (F11–F12) filtrar caracteres de control, de ancho cero y de dirección (bidi) en `note` y `reason` **antes** de mostrarlos al personal: se hace aquí (regla 14).

## Reglas de negocio

### Acceso y datos
1. **`/solicitudes`:** sin sesión → redirige a `/login`. Con sesión de un prestatario → «Solo para el personal de la biblioteca.» (`role="alert"`). El `<h1>` es siempre «Solicitudes de docente». La lectura de la sesión va dentro de `<Suspense>` con `await connection()` (S1, regla 1).
2. **Estado mostrado:** `?status=PENDIENTE|APROBADA|RECHAZADA` en la dirección; ausente o inválido → `PENDIENTE`. Una barra de enlaces «Pendientes», «Aprobadas» y «Rechazadas» (`<nav aria-label="Estado de las solicitudes">`) marca la activa con `aria-current="page"`. El orden y la paginación son los del servicio (más antigua primero; 50 por página; `?after=` con el `member_id` de la última). Se reutiliza el patrón de «Volver al inicio» y «Siguiente» de `/cuentas`, conservando `status` en los enlaces. Un `after` inexistente → «No se encontró esa página. Vuelve al inicio.» (como `/cuentas`).
3. **Sin solicitudes:** «No hay solicitudes pendientes.», «No hay solicitudes aprobadas.» o «No hay solicitudes rechazadas.» según el estado.

### Cada solicitud (`<article>`, en una lista `<ul>`)
4. Muestra: nombre de la persona (`<h2>`), correo, rol actual en español (`Externo`/`Estudiante`), «Enviada el {fecha}» con `<time datetime>`, la nota completa (texto, con los saltos de línea respetados y sin HTML) y el estado del correo: «Correo verificado» o «Correo sin verificar» (icono + texto; nunca solo color). Las resueltas añaden «Aprobada el {fecha}» o «Rechazada el {fecha}» y, si hay motivo, «Motivo: {reason}». Fechas en español, zona `America/Bogota`, con el formateador que ya usa la app.
5. **Solo las pendientes** tienen acciones «Aprobar» y «Rechazar». Las aprobadas y rechazadas son de solo lectura.

### Aprobar
6. **Dos pasos** (aprobar no se puede deshacer: el rol de docente no se quita). El primer clic en «Aprobar» cambia el botón a «Confirmar aprobación» y muestra «Cancelar»; el segundo envía `POST /api/teacher-requests/{member_id}/approve` sin cuerpo.
7. **Correo sin verificar:** el botón «Aprobar» queda deshabilitado, con el texto visible «No se puede aprobar hasta que la persona verifique su correo.» (pregunta 5). «Rechazar» sigue disponible.
8. Éxito → «Aprobada: {Nombre} ahora es docente.» en `role="status"` y la lista se recarga (`router.refresh()`); la solicitud sale de «Pendientes». Mientras envía, los botones se deshabilitan (sin doble envío).

### Rechazar
9. «Rechazar» abre, en la misma tarjeta, un `<textarea>` «Motivo (opcional)» (hasta 300 caracteres, contador visible) y los botones «Confirmar rechazo» y «Cancelar». Envía `POST /api/teacher-requests/{member_id}/reject` con `{ reason }` (se omite si está vacío). Éxito → «Rechazada la solicitud de {Nombre}.» y la lista se recarga.
10. Si el texto no pasa la validación (regla 14) se muestra el mensaje del servidor y no se pierde lo escrito.

### Errores de las acciones
11. Cualquier error del servidor se muestra con su mensaje (validado con `ApiErrorSchema` en el mismo punto), en `role="alert"` enlazado a la tarjeta con `aria-describedby`. Casos esperados: 409 «La solicitud ya fue resuelta.» (otro miembro del personal se adelantó: además de mostrar el mensaje se recarga la lista), 409 «La cuenta ya no puede recibir el rol de docente.», 409 «El correo de la persona ya no está verificado.», 404, 403/401 (sesión caducada: «Tu sesión terminó. Vuelve a ingresar.» con enlace a `/login`). Fallo de red → «No se pudo completar la acción».

### Barra de navegación
12. El personal ve el enlace «Solicitudes» → `/solicitudes` junto a «Préstamos» y «Cuentas». Los prestatarios no lo ven. No lleva contador (pregunta 6).

### Seguridad
13. Todo lo que viene de la persona (`note`, `reason`, nombre, correo) se muestra como texto escapado de React; nunca `dangerouslySetInnerHTML`. La nota larga o sin espacios no desborda la tarjeta (`break-words`).
14. **Contrato (`note` y `reason`):** además de lo de F11–F12, se rechazan (→ 400 con «No uses caracteres de control ni invisibles.») los caracteres de control salvo el salto de línea (`\n`), los de ancho cero y marcas de dirección (`U+200B`–`U+200F`, `U+202A`–`U+202E`, `U+2060`–`U+2064`, `U+2066`–`U+2069`, `U+FEFF`). Se comprueba sobre el texto ya recortado y **antes** de contar la longitud mínima. Las notas ya guardadas no se tocan (el render las escapa igual). Un texto de 10 `U+200B` ya no pasa (pregunta 3). Consecuencias que hay que conocer: (a) un carácter prohibido que quede **en los extremos** de un texto que el recorte elimina (`U+0009`, `U+000B`, `U+000D`, `U+FEFF`) no se rechaza, porque la comprobación es sobre el texto ya recortado; en el medio sí; (b) los emojis compuestos con `U+200D` (unión de ancho cero, p. ej. 👩‍🏫) quedan rechazados; (c) `U+00AD`, `U+2028` y `U+2029` no están en la lista y se aceptan. El mensaje de la regla viaja en `issues[].message` de la respuesta 400 (el campo `error` dice «Datos inválidos»): las pantallas de solicitud y de rechazo lo leen de ahí (`HIDDEN_CHARACTERS_MESSAGE`, exportado por el contrato).

## Entradas y salidas
| Pieza | Entrada | Salida |
| --- | --- | --- |
| `/solicitudes?status=&after=` | sesión de personal | lista de solicitudes con acciones (pendientes) o de solo lectura |
| Aprobar / Rechazar | clic confirmado; `reason?` (≤ 300) | mensaje de éxito o de error; lista recargada |
| `CreateTeacherRequestInput`, `RejectTeacherRequestInput` | como en F11–F12 + regla 14 | 400 con el mensaje de la regla 14 si hay caracteres no permitidos |

Errores esperados (clase → cuándo): los de F11–F12 (`ConflictError`, `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ZodError` → 400); la pantalla los traduce a mensajes (regla 11).

## Autorización
- **Sí:** `BIBLIOTECARIO` y `ADMINISTRADOR` activos.
- **No:** prestatarios (ven «Solo para el personal de la biblioteca.»); sin sesión redirige a `/login`. El servidor sigue siendo la barrera real: la pantalla solo oculta; cada acción vuelve a comprobar el rol (F11–F12).

## Criterios de aceptación
- **Dado** un bibliotecario o el administrador, **cuando** abre `/solicitudes`, **entonces** ve las pendientes de la más antigua a la más reciente, cada una con nombre, correo, rol, fecha, nota completa y estado del correo.
- **Dado** un `ESTUDIANTE`, **cuando** abre `/solicitudes`, **entonces** ve «Solo para el personal de la biblioteca.»; **dado** un visitante, **entonces** va a `/login`.
- **Dado** `?status=APROBADA`, **entonces** ve las aprobadas sin botones; con `?status=algo` inválido, **entonces** ve las pendientes.
- **Dado** una solicitud con el correo verificado, **cuando** pulsa «Aprobar» y luego «Confirmar aprobación», **entonces** ve «Aprobada: {Nombre} ahora es docente.», la solicitud desaparece de «Pendientes» y aparece en «Aprobadas».
- **Dado** una solicitud con el correo sin verificar, **entonces** «Aprobar» está deshabilitado y se lee el motivo; «Rechazar» funciona.
- **Dado** el primer clic en «Aprobar», **cuando** pulsa «Cancelar», **entonces** no se envía nada y el botón vuelve a «Aprobar».
- **Dado** «Rechazar» con motivo de 300 caracteres, **entonces** se rechaza; **dado** un motivo de 301 o con `U+200B`, **entonces** ve el error del servidor y conserva el texto.
- **Dado** que otro miembro del personal resolvió la solicitud primero, **cuando** pulsa «Confirmar aprobación», **entonces** ve «La solicitud ya fue resuelta.» y la lista se recarga sin esa solicitud.
- **Dado** 51 pendientes, **entonces** la primera página muestra 50 y un enlace «Siguiente» que conserva `status`; **dado** un `after` inexistente, **entonces** ve «No se encontró esa página».
- **Dado** una `note` con `<script>` o con saltos de línea, **entonces** se muestra como texto y los saltos se conservan.
- **Dado** una `note` de 10 caracteres `U+200B`, **cuando** una persona la envía en F11, **entonces** 400.
- **Dado** el personal, **entonces** la barra muestra «Solicitudes»; **dado** un prestatario, **entonces** no.
- **Dado** `/solicitudes` a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, los botones miden al menos 44 px y todo se usa con teclado.

## Bordes
- Listas de 0, 1, 50 y 51 solicitudes; `after` ausente, válido, inexistente y mal formado (`a/b`); `status` ausente, válido e inválido.
- Nota de 10 y de 500 caracteres, con saltos de línea, con una palabra de 500 letras sin espacios, con HTML, con emojis y con caracteres de ancho cero (rechazada al enviarse).
- Motivo vacío, de 1, 300 y 301 caracteres.
- Nombre muy largo (120 caracteres) y correo de 254.
- Doble clic en «Confirmar»; dos personas del personal a la vez; sesión caducada a mitad de la acción; fallo de red.
- Persona cuya cuenta se borró (el listado la omite, ya cubierto en F11–F12).

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `accounts/schema.ts` | orquestador | Regla 14: validación de caracteres no permitidos en `CreateTeacherRequestInputSchema.note` y `RejectTeacherRequestInputSchema.reason` (función pura compartida, sin ternarios) |
| `app/solicitudes/page.tsx` | frontend | Reglas 1–3; lee `status` y `after` de `searchParams`; patrón de `app/cuentas/page.tsx` |
| `accounts/ui/teacher-request-list.tsx` | frontend | Reglas 4–5 y 13: lista de tarjetas; función pura de textos (`describeRequestStatus`, formato de fechas) para probar sin navegador |
| `accounts/ui/teacher-request-actions.tsx` | frontend | Cliente: reglas 6–11 (aprobar en dos pasos, rechazar con motivo, errores, `router.refresh()`); respuestas validadas con Zod; `messageForDecisionError<T>(error)` pura |
| `accounts/ui/account-pagination.tsx` (o uno nuevo) | frontend | Generalizar la ruta base y conservar parámetros (`status`) sin romper `/cuentas` |
| `accounts/ui/nav-bar.tsx` | frontend | Regla 12 |
| Pruebas | tests | Todos los criterios con `renderToStaticMarkup` y funciones puras; el esquema de la regla 14 (todos los rangos de caracteres, límites de longitud, `\n` permitido); el enlace de la barra por rol; que `/cuentas` y su paginación sigan igual |

Reparto sugerido: orquestador fija `schema.ts` → **backend** no tiene trabajo (la API no cambia) ∥ **frontend** ∥ **tests** → `npm run check:full` → `security` → handoff. No hay cambios de repositorio ni de rutas.

## Fuera de alcance
`/personal` y todo lo de bibliotecarios (F13–F14, parte 2 de F37), quitar el rol de docente, avisar por correo a la persona de la decisión, un contador de pendientes en la barra, buscar o filtrar solicitudes por nombre, mostrar quién resolvió cada solicitud (nombre del bibliotecario), deshacer una decisión, pruebas de navegador.

## Preguntas abiertas (resueltas)
La persona aceptó la propuesta de cada una:
1. **Aprobar en dos pasos** (regla 6): sí.
2. **Quién resolvió:** no se muestra el nombre, solo la fecha.
3. **Caracteres invisibles** (regla 14): se **rechazan** con 400 y un mensaje claro.
4. **Estados** (regla 2): tres enlaces (Pendientes, Aprobadas, Rechazadas) en una sola pantalla.
5. **Aprobar sin correo verificado** (regla 7): el botón queda deshabilitado con la explicación.
6. **Contador en la barra** (regla 12): no.
7. **Consecuencias de la regla 14** (extremos recortados, emojis con `U+200D` rechazados, `U+00AD`/`U+2028`/`U+2029` aceptados): se mantienen tal como están; no se relaja ninguna.
