# Lista de features (FDD)

Una feature = **acción + resultado + objeto**, pequeña y con valor visible ("Prestar un libro a una persona"). Se construyen una por una, con su especificación (`write-spec`) aprobada por la persona **antes** de delegar. Las reglas de código están en `AGENTS.md`.

## Roles

| Rol | Cómo se obtiene | Presta libros | Plazo | Cupo de préstamos activos (físicos y, aparte, digitales) | Renovaciones por préstamo |
| --- | --- | --- | --- | --- | --- |
| `EXTERNO` | Autorregistro (seleccionable) | Sí | **15 días** | **3** + **3** | **2** |
| `ESTUDIANTE` | Autorregistro (seleccionable) | Sí | **20 días** | **3** + **3** | **2** |
| `DOCENTE` | Solicitud + **verificación de un bibliotecario** (no seleccionable) | Sí | **30 días** | **5** + **5** | **3** |
| `BIBLIOTECARIO` | **Solo lo crea el `ADMINISTRADOR`** | No: gestiona los préstamos de otros | — | — | — |
| `ADMINISTRADOR` | Creado por el script de arranque (`seed`), no por la web. **Hay uno solo.** | No: gestiona todo | — | — | — |

Atajos en este documento: **prestatario** = `EXTERNO`, `ESTUDIANTE` o `DOCENTE`. **Personal** = `BIBLIOTECARIO` o `ADMINISTRADOR`.

### Reglas de cuentas y roles (no negociables)
1. En el autorregistro solo se pueden elegir `EXTERNO` o `ESTUDIANTE`. Cualquier otro valor de `role` en el cuerpo de la petición → `400` (el servidor nunca confía en el rol que manda el cliente).
2. `DOCENTE` solo se obtiene cuando un bibliotecario (o el administrador) **aprueba** una solicitud. Mientras está pendiente o si se rechaza, la persona conserva su rol anterior y su plazo.
3. **Un bibliotecario no puede crear, ascender ni aprobar a otro bibliotecario o administrador** → `ForbiddenError`. Solo el `ADMINISTRADOR` crea bibliotecarios.
4. Un bibliotecario solo puede crear cuentas `EXTERNO`/`ESTUDIANTE` (atención en mostrador). Nadie crea administradores desde la web.
5. Un bibliotecario no puede desactivar a otro bibliotecario ni al administrador; el administrador sí puede desactivar bibliotecarios.
6. La identidad y el rol salen siempre de la sesión.
7. **Solo existe un `ADMINISTRADOR`**, creado por el `seed`. Un segundo alta con ese rol se rechaza (`ConflictError`) y la persistencia lo garantiza (documento fijo creado en una transacción, ADR-0003).
8. El personal no pide libros prestados con su cuenta de trabajo.

## Features

Ola = orden de construcción sugerido (cada ola es entregable por sí sola).

| Id | Feature | Rol | Ola |
| --- | --- | --- | --- |
| **Base** | | | |
| F1 | Registrar un libro | Personal | 1 |
| F2 | Buscar libros por título o autor | Público | 1 |
| F3 | Registrar una cuenta desde el mostrador (`EXTERNO`/`ESTUDIANTE`) | Personal | 1 |
| F4 | Ingresar con correo y contraseña | Todos | 1 |
| **Préstamos** | | | |
| F5 | Prestar un libro físico (plazo y cupo según el rol) | Personal; el prestatario solo a sí mismo | 1 |
| F6 | Devolver un libro | Personal | 1 |
| F7 | Calcular la multa por retraso | Sistema | 1 |
| F8 | Listar los préstamos vencidos de una persona | Prestatario (los suyos) · Personal (cualquiera) | 1 |
| F9 | Panel: préstamos por mes | Personal | 5 (opcional) |
| F23 | Ver mis préstamos (activos e historial) | Prestatario · Personal (de cualquiera) | 4 |
| F24 | Renovar un préstamo | Prestatario | 4 |
| F25 | Reservar un libro sin ejemplares disponibles | Prestatario | 5 (opcional) |
| F26 | Registrar y saldar multas | Personal | 4 |
| **Cuentas y roles** | | | |
| F10 | Autorregistrarse como externo o estudiante | Público | 2 |
| F11 | Solicitar el rol de docente | Prestatario con sesión | 2 |
| F12 | Aprobar o rechazar una solicitud de docente | Personal | 2 |
| F13 | Crear una cuenta de bibliotecario | Administrador | 2 |
| F14 | Desactivar y reactivar una cuenta | Personal (con límites, regla 5) | 2 |
| F15 | Cambiar mi contraseña | Todos | 2 |
| F16 | Recuperar mi contraseña olvidada (la restablece la propia persona con el correo de Firebase) | Público | 2 |
| F17 | Limitar los intentos de ingreso fallidos | Sistema | 2 |
| **Catálogo** | | | |
| F18 | Editar los datos y los ejemplares de un libro | Personal | 4 |
| F19 | Retirar un libro del catálogo | Personal | 4 |
| F20 | Clasificar libros por categoría y año, y filtrar por ellos | Personal (registra) · Público (filtra) | 4 |
| F21 | Paginar los resultados de la búsqueda | Público | 4 |
| F22 | Validar el ISBN con su dígito verificador | Personal | 4 |
| **Lector interactivo** | | | |
| F27 | Cargar el contenido digital de un libro y fijar sus copias digitales | Personal | 3 |
| F38 | Pedir prestada la copia digital de un libro (aprobación automática según el cupo) | Prestatario | 3 |
| F28 | Abrir un libro en el lector interactivo | Prestatario con préstamo digital activo | 3 |
| F29 | Proteger la lectura al perder el foco (bloqueo + mensaje de derechos de autor) | Sistema (lector) | 3 |
| F30 | Marcar cada página con el nombre del lector | Sistema (lector) | 3 |
| F31 | Guardar el progreso y los marcadores de lectura | Prestatario | 3 |
| F32 | Registrar y consultar los incidentes de lectura | Sistema · Personal (consulta) | 3 |
| **Interfaz** | | | |
| F33 | Barra de navegación con sesión y cierre de sesión | Todos | 1 |
| F34 | Pantalla de préstamos y devoluciones (`/prestamos`) | Personal | 1 |
| F35 | Pantallas «Mis préstamos» y «Mis vencidos» | Prestatario | 1 |
| F36 | Formularios para registrar libros y cuentas | Personal | 2 |
| F37 | Pantallas de solicitudes de docente y de gestión de personal | Personal · Administrador | 2 |

## Áreas y carpetas

Cada área agrupa features y tiene su carpeta en `app/features/` (ver `docs/architecture.md`).

| Área | Carpeta | Features |
| --- | --- | --- |
| Cuentas y roles | `app/features/accounts` | F3, F4, F10–F17, F37 |
| Catálogo | `app/features/catalog` | F1, F2, F18–F22, F36 (libros) |
| Préstamos | `app/features/loans` | F5–F9, F23–F26, F34, F35 |
| Lector interactivo | `app/features/reader` | F27–F32, F38 |
| Transversal | `app/` (páginas), `app/shared/` | F33 (navegación y sesión) |

## Modelo de dominio

`Libro (isbn, título, autor, ejemplares, copias digitales, categoría?, año?, retirado?)` · `Cuenta (nombre, correo, rol, activa, solicitudDocente?)` · `Préstamo (libro, cuenta, tipo FISICO|DIGITAL, prestado, vence, devuelto?, renovaciones)` · `Multa (préstamo, monto, pagada?)` · `ContenidoDigital (libro, archivo Markdown en Vercel Blob)` · `SesiónDeLectura (préstamo, página actual, marcadores)` · `IncidenteDeLectura (cuenta, libro, página, cuándo, duración)`.
Un libro tiene N ejemplares físicos y M copias digitales, **contadas aparte**. Disponibles = ejemplares − préstamos físicos activos; disponibles digitales = copias digitales − préstamos digitales activos.

## Reglas de negocio de préstamos (F5–F8, F23–F26, F38)

Los valores van en `LOAN_RULES` (`app/features/loans/schema.ts`): `loanDaysByRole`, `maxActiveLoansByRole`, `maxRenewalsByRole`, `fineCopPerDay` y `fineCapCop`.

- **Plazo por rol:** `EXTERNO` 15 días · `ESTUDIANTE` 20 días · `DOCENTE` 30 días, contados desde el momento del préstamo. El plazo sale del rol **vigente al prestar**; si después cambia el rol, los préstamos ya hechos no se recalculan.
- **Quién puede pedir prestado:** solo prestatarios activos. El personal no pide prestado con su cuenta de trabajo → `ForbiddenError`.
- **Cupo:** como máximo **3** préstamos activos para `EXTERNO` y `ESTUDIANTE`, y **5** para `DOCENTE`. La misma cifra rige para los físicos y para los digitales, pero **se cuentan por separado**: un estudiante puede tener 3 físicos y 3 digitales a la vez. La multa es igual para todos los roles.
- **Disponibilidad:** no se presta si no hay ejemplares (o copias digitales) disponibles. Un libro retirado (F19) no se presta.
- **Cuenta inactiva** no puede pedir prestado.
- **Bloqueo por deuda (F26):** no se presta a quien tenga préstamos vencidos o multas sin pagar → `ConflictError`.
- **Días de retraso:** cualquier fracción de día pasado el vencimiento cuenta como un día completo (`ceil`). Devolver exactamente en la fecha de vencimiento no es retraso.
- **Multa por defecto:** 500 COP por día de retraso, con tope de 20.000 COP, igual para todos los roles. La política debe poder cambiarse sin modificar el servicio de préstamos (patrón Strategy).
- **Devolución:** se cierra el préstamo con la fecha dada y se informa la multa (0 si no hay retraso). No se puede devolver dos veces. Si hay multa, se registra pendiente (F26).
- **Vencidos de una persona (F8):** solo préstamos **activos** con vencimiento anterior a `now`. Un prestatario solo consulta los suyos; si pide los de otra persona recibe `ForbiddenError` **aunque esa persona no exista** (para no revelar quién existe). El personal consulta los de cualquiera; si no existe, `NotFoundError`.
- **Renovación (F24):** vale para préstamos físicos y digitales. Máximo **2** veces por préstamo (`EXTERNO`, `ESTUDIANTE`) y **3** (`DOCENTE`); solo si el préstamo no está vencido; extiende el plazo del rol desde `now`. Si existiera la reserva (F25), no se renueva un libro reservado por otra persona.
- **Préstamo digital (F38):** lo pide el propio prestatario, sin intervención del personal. El sistema lo **aprueba automáticamente** si se cumplen todas las reglas anteriores (cuenta activa, cupo, sin deuda) y además hay una copia digital disponible y el libro tiene contenido cargado (F27); si no, lo **rechaza** (`ConflictError` o `ForbiddenError` según la causa). Tiene el plazo del rol y consume una copia digital hasta que se devuelve o vence. La propia persona puede **devolverla antes** del vencimiento. **Al vencer, el sistema retira el préstamo sin multa**: el acceso termina y la copia vuelve a estar disponible. Como no hay tareas programadas, el vencimiento se aplica de forma derivada con el `now` inyectado: un préstamo digital con `due_at` anterior a `now` ya no cuenta como activo ni da acceso, y se cierra (`returned_at`) la primera vez que se consulta.

## Reglas del lector interactivo (F27–F32, F38)

**Objetivo:** que un libro digital se pueda leer en el navegador solo mientras el préstamo digital está vigente, y que la lectura quede protegida y trazable.

1. **Quién puede leer:** solo la persona con un **préstamo digital activo propio** de ese libro. Nadie lee sin préstamo, tampoco el personal (no hay previsualización). Al devolver o vencer, el acceso termina (`ForbiddenError`). El servidor lo comprueba en cada petición de página.
2. **Formato del contenido:** un archivo **Markdown** por libro, guardado en un store privado de Vercel Blob (ruta guardada en el libro, ADR-0003) y dividido en páginas por el servidor. El contenido nunca se sirve por URL. EPUB queda como posible importación futura: exige descomprimir el archivo, sanear el XHTML y una dependencia nueva (ADR). El Markdown se muestra como texto saneado (sin HTML crudo).
3. **Contenido por trozos:** el servidor entrega **una página por petición** y nunca el libro completo, con un límite de ritmo por sesión (valor a fijar en la spec).
4. **Pérdida de foco (F29):** cuando la pestaña se oculta (`visibilitychange`), la ventana pierde el foco (`blur`) o la página se descarga/oculta (`pagehide`):
   - el texto se **retira del DOM** (no solo se tapa con CSS) y aparece una capa a pantalla completa con la marca de agua y el mensaje de derechos de autor (`docs/mensaje-derechos-de-autor.md`);
   - al volver, **no** se muestra el texto solo: la persona pulsa «Continuar leyendo», con la ventana visible y enfocada, y la página se vuelve a pedir al servidor.
5. **Inactividad:** tras 5 minutos sin interacción, se activa el mismo bloqueo (el tiempo se inyecta; las pruebas no esperan en tiempo real).
6. **Marca de agua personal (F30):** en todo momento, sobre el texto, en diagonal y repetida: nombre de la persona + fecha. Sirve para disuadir y para rastrear una filtración.
7. **Disuasión de copia:** sin selección de texto, copiar/cortar, menú contextual ni arrastre; el estilo de impresión (`@media print`) no muestra el texto.
8. **Trazabilidad (F32):** cada pérdida de foco guarda un incidente (persona, libro, página, instante, duración). El personal puede consultarlos; la persona no puede borrarlos.
9. **Límite honesto:** ninguna medida en el navegador puede impedir una foto de la pantalla ni una captura hecha por el sistema operativo. Estas medidas **disuaden y dejan rastro**; no son DRM. La protección real es: acceso solo con préstamo, página a página y marca de agua con nombre.

## Autenticación y recuperación de contraseña (F4, F10, F15, F16)

Las credenciales viven en **Firebase Authentication** (ADR-0003); la app nunca guarda contraseñas. El registro, el ingreso, el cambio y la recuperación usan correo y contraseña de Firebase; la contraseña tiene entre 8 y 100 caracteres. F16: la persona restablece su propia contraseña desde la pantalla de ingreso con el enlace que Firebase envía por correo; el personal no restablece contraseñas ajenas. La pantalla muestra el mismo mensaje exista o no la cuenta, para no revelar quién está registrado. El rol, el estado y los demás datos de la cuenta viven en Firestore (`members/{uid}`).

## Contrato

Los `schema.ts` son el acuerdo entre agentes y solo los cambia el orquestador. Contenido esperado:

- `app/shared/schema.ts`: `IdSchema` (texto no vacío: `uid` de Firebase para las cuentas e id de documento para lo demás); `RoleSchema` con los 5 roles y las listas derivadas `BORROWER_ROLES`, `STAFF_ROLES`, `SELECTABLE_ROLES`; `SessionUserSchema` (`member_id`, `role`); `ApiErrorSchema`.
- `app/features/accounts/schema.ts`: `LoginInput`, `CreateMemberInput` (solo `EXTERNO|ESTUDIANTE`), `ProvisionMemberInput` (cualquier rol, solo scripts), `Member`; después, la solicitud de docente (F11–F12), la creación de bibliotecarios (F13) y la recuperación de contraseña (F16).
- `app/features/catalog/schema.ts`: `CreateBookInput` (`isbn`, `title`, `author`, `copies`), `Book` (con `available`), `SearchBooksQuery`; después, `digital_copies` (F27), categoría y año (F20).
- `app/features/loans/schema.ts`: `LOAN_RULES` (ver arriba), `Loan`, `LendInput`, `ReturnResult`, `OverdueLoan` y el puerto `LoanServicePort`; después, renovación (F24), multa persistida (F26) y el tipo de préstamo físico/digital (F38).
- `app/features/reader/schema.ts` (F27–F32): páginas, sesión de lectura, incidentes y el texto del mensaje de derechos de autor.
- Todos los campos que viajan por el cable están en `snake_case` (ADR-0005).

## Superficie HTTP esperada (la construye el agente de backend)

| Método y ruta | Feature | Quién |
| --- | --- | --- |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | F4 | Todos |
| `POST /api/auth/register` | F10 | Público (rol solo `EXTERNO`/`ESTUDIANTE`) |
| `POST /api/members` · `GET /api/members` | F3 | Personal (solo `EXTERNO`/`ESTUDIANTE`) |
| `POST /api/staff` | F13 | Administrador |
| `POST /api/me/teacher-request` | F11 | Prestatario |
| `POST /api/teacher-requests/:id/approve` · `/reject` | F12 | Personal |
| `PATCH /api/members/:id/active` | F14 | Personal (con límites) |
| `POST /api/me/password` | F15 | Todos |
| `POST /api/auth/forgot-password` | F16 | Público |
| `POST /api/books` · `GET /api/books?q=&category=&page=` | F1 · F2 · F20 · F21 | Personal (crear) · Público (buscar) |
| `PATCH /api/books/:id` · `DELETE /api/books/:id` | F18 · F19 | Personal |
| `POST /api/loans` `{ member_id, book_id }` | F5 | Personal; un prestatario solo con su propio `member_id` (si no, 403) |
| `POST /api/loans/:id/return` | F6 | Personal |
| `POST /api/loans/:id/renew` | F24 | Prestatario (propio) |
| `GET /api/members/:id/loans` | F23 | Prestatario (propio) · Personal |
| `GET /api/members/:id/overdue` | F8 | Prestatario (propio) · Personal |
| `POST /api/digital-loans` `{ book_id }` | F38 | Prestatario (aprobación automática) |
| `PUT /api/books/:id/content` | F27 | Personal |
| `GET /api/reader/:loan_id/pages/:n` | F28 | Prestatario con préstamo digital activo |
| `PUT /api/reader/:loan_id/progress` · `POST …/bookmarks` | F31 | Prestatario (propio) |
| `POST /api/reader/:loan_id/incidents` · `GET /api/reader/incidents` | F32 | Lector · Personal |
| `POST /api/fines/:id/pay` | F26 | Personal |

Interfaces mínimas (frontend): `/` (búsqueda, F2), `/login` (F4), `/cuentas` (lista, personal), `/prestamos` (F34), `/mis-prestamos` y `/mis-vencidos` (F35), `/registro` (F10), `/libros/nuevo` y `/cuentas/nuevo` (F36), `/solicitudes` y `/personal` (F37), `/leer/[loanId]` (F28–F31).
