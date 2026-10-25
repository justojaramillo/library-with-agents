# F36 · Formularios para registrar libros y cuentas de mostrador

- **Estado:** Aprobada (la persona respondió las tres preguntas y aprobó, 2026-10-25)
- **Rol(es):** personal (`BIBLIOTECARIO`, `ADMINISTRADOR`)
- **Contrato afectado:** ninguno. Se reutilizan `CreateBookInputSchema` (`app/features/catalog/schema.ts`) y `CreateMemberInputSchema` (`app/features/accounts/schema.ts`). Las rutas `POST /api/books` (F1) y `POST /api/members` (F3) no cambian.
- **Depende de:** `docs/specs/F1-registrar-libro.md`, `docs/specs/F3-F4-roles-y-cuentas.md`, `docs/specs/F13-F14-bibliotecarios-y-desactivar-cuentas.md` (patrón de formulario y de página de personal) y `docs/specs/F33-navegacion-y-pantallas-base.md`.
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA, Cache Components).

## Objetivo
El personal registra un libro nuevo y crea una cuenta de mostrador (`EXTERNO` o `ESTUDIANTE`) desde pantallas, sin llamar a la API a mano.

## Qué hay hoy y qué cambia
- `POST /api/books` (F1) crea el libro, invalida la caché del catálogo y devuelve 201 con `available = copies`; ISBN repetido → 409. `POST /api/members` (F3) crea una cuenta `EXTERNO` o `ESTUDIANTE` (cualquier otro rol → 400) con la contraseña que elige el personal; correo repetido → 409. Ambas son solo para personal y ya están probadas.
- No existe ninguna pantalla para ninguna de las dos. `/libros/nuevo` y `/cuentas/nuevo` figuran en la lista de rutas de `docs/features.md` pero no están construidas.
- El patrón de formulario de personal ya existe en `staff-form.tsx` (F13).

## Reglas de negocio

### `/libros/nuevo` (registrar un libro)
1. Solo personal. Sin sesión → redirige a `/login`. Un prestatario → «Solo para el personal de la biblioteca.» (`role="alert"`). `<h1>` «Registrar libro». Sesión leída dentro de `<Suspense>` con `await connection()` (S1, regla 1).
2. **Campos:** «ISBN» (texto; ayuda «10 o 13 dígitos»), «Título» (1–200), «Autor» (1–120), «Ejemplares» (número entero de 1 a 100; valor inicial 1). `autocomplete="off"` en el ISBN; `inputmode="numeric"` en ISBN y ejemplares. Botón «Registrar libro», deshabilitado mientras envía.
3. **ISBN con guiones o espacios** (pregunta 1): el formulario quita los guiones y los espacios del ISBN antes de validar y enviar, de modo que «978-84-376-0494-7» se envía como `9788437604947`. El contrato del servidor no cambia (con guiones sigue dando 400 si se llama a la API directamente).
4. **Validación en el navegador** con `CreateBookInputSchema` tras la normalización del ISBN; mensajes en español junto a cada campo (`aria-describedby`): «El ISBN debe tener 10 o 13 dígitos.», «Escribe el título (hasta 200 caracteres).», «Escribe el autor (hasta 120 caracteres).», «Los ejemplares deben ser un número entero de 1 a 100.». Con errores no se llama al servidor.
5. **Envío:** `POST /api/books`. Éxito (201) → «Se registró «{Título}» con {N} ejemplar.» si N es 1 y «… con {N} ejemplares.» si es más en `role="status"`, el formulario se limpia (ejemplares vuelve a 1) y el foco vuelve al campo «ISBN» para registrar otro. 409 → «Ya existe un libro con ese ISBN.» (o el mensaje del servidor, validado con `ApiErrorSchema`); 400 → «Revisa los datos del formulario.»; 401/403 → «Tu sesión terminó. Vuelve a ingresar.» o el mensaje del servidor; red → «No se pudo registrar el libro». Sin doble envío.
6. Tras registrar, el libro aparece en la búsqueda pública de `/` (la caché ya se invalida en la ruta). La pantalla no lista libros.

### `/cuentas/nuevo` (crear una cuenta de mostrador)
7. Solo personal (mismo acceso que la regla 1). `<h1>` «Nueva cuenta».
8. **Campos:** «Nombre» (1–120), «Correo» (válido, hasta 254), «Contraseña» (8–100, ayuda «Entre 8 y 100 caracteres»), y un grupo `fieldset`/`legend` «Tipo de cuenta» con dos opciones (`radio`): «Externo» (por defecto) y «Estudiante». **No hay opción de docente ni de personal** (el docente lo aprueba el personal con F11–F12; el bibliotecario lo crea el administrador con F13). `autocomplete` `off`, `off`, `new-password`. Botón «Crear cuenta».
9. **Validación** con `CreateMemberInputSchema`; mensajes junto a cada campo; con errores no se llama al servidor.
10. **Envío:** `POST /api/members` con `{ name, email, password, role }`. Éxito (201) → «Se creó la cuenta de {Nombre}. Entrégale el correo y la contraseña; puede cambiarla después.» en `role="status"`, el formulario se limpia y el foco vuelve a «Nombre». 409 → «Ya existe una cuenta con ese correo.»; 400 → «Revisa los datos del formulario.»; 401/403 → como la regla 5; red → «No se pudo crear la cuenta». La contraseña nunca se muestra después del envío ni se conserva en el estado (campo no controlado).
11. **Cuentas de mostrador sin correo verificado:** quedan sin verificar y ese dato no las limita (solo el rol de docente lo exige, F11). La persona puede cambiar su contraseña (F15) o recuperarla (F16).

### Enlaces
12. **Botones dentro de las páginas donde corresponden** (pregunta 2): en `/cuentas`, un enlace con aspecto de botón «Nueva cuenta» (≥ 44 px) encima de la lista; en `/` (donde se buscan los libros), un enlace con aspecto de botón «Registrar libro» junto a la búsqueda. Ambos solo para el personal. En `/` el botón vive en un componente propio dentro de `<Suspense>` que lee la sesión con `await connection()` (S1), de modo que el resto de la página sigue prerenderizado y la búsqueda no cambia; para visitantes y prestatarios no se muestra nada (y sin alterar el diseño). **No se añade nada a la barra de navegación** (su rediseño es de F15). Las pantallas nuevas llevan un enlace «Volver» a `/cuentas` (cuenta) y a `/` (libro).

## Entradas y salidas
| Pieza | Entrada | Salida |
| --- | --- | --- |
| `/libros/nuevo` | `{ isbn, title, author, copies }` | `POST /api/books` → 201 `Book` · mensajes de error |
| `/cuentas/nuevo` | `{ name, email, password, role }` | `POST /api/members` → 201 `Member` · mensajes de error |

Errores esperados (los de F1 y F3, traducidos a mensajes): `400` validación · `401` sin sesión · `403` rol · `409` ISBN o correo repetido.

## Autorización
Solo `BIBLIOTECARIO` y `ADMINISTRADOR` activos. Prestatarios: mensaje en pantalla (y 403 en la API). Sin sesión: redirige a `/login` (y 401 en la API). El servidor sigue siendo la barrera real: las pantallas solo ocultan.

## Criterios de aceptación
- **Dado** el personal, **cuando** rellena ISBN, título, autor y ejemplares válidos, **entonces** ve «Se registró «{Título}» con {N} ejemplar.» si N es 1 y «… con {N} ejemplares.» si es más, el formulario queda limpio y el libro aparece al buscarlo en `/`.
- **Dado** un ISBN con guiones («978-84-376-0494-7») o con espacios, **entonces** se registra con el ISBN sin ellos; **dado** un ISBN de 9 o 14 dígitos, o con letras, **entonces** ve el error del campo y no se llama al servidor.
- **Dado** un ISBN ya registrado, **entonces** ve «Ya existe un libro con ese ISBN.» y el catálogo no cambia.
- **Dado** ejemplares 0, 101, decimal o vacío, **entonces** ve el error del campo; con 1 y con 100, se registra.
- **Dado** el personal, **cuando** crea una cuenta con rol Externo o Estudiante, **entonces** ve el mensaje de éxito y la persona puede ingresar con esas credenciales.
- **Dado** un correo ya registrado (también con otras mayúsculas), **entonces** ve «Ya existe una cuenta con ese correo.».
- **Dado** el formulario de cuenta, **entonces** solo ofrece Externo y Estudiante; una petición con otro rol a la API sigue dando 400.
- **Dado** una contraseña de 7 caracteres, **entonces** ve el error del campo; de 8 y de 100, se crea; de 101, error.
- **Dado** un prestatario o un visitante, **cuando** abre cualquiera de las dos pantallas, **entonces** ve el mensaje de acceso o va a `/login`, respectivamente.
- **Dado** el personal, **entonces** ve «Nueva cuenta» en `/cuentas` y «Registrar libro» en `/`; un prestatario o un visitante no ve ninguno de los dos, y la búsqueda de `/` funciona igual para todos.
- **Dado** cualquiera de las dos pantallas a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, los controles miden al menos 44 px, el foco es visible y todo se usa con teclado; los errores van en `role="alert"` enlazados con `aria-describedby`.

## Bordes
- Libro: ISBN de 9, 10, 13 y 14 dígitos, con guiones, con espacios, con letras, vacío; título de 0, 1, 200 y 201 caracteres y solo con espacios; autor de 120 y 121; ejemplares 0, 1, 100, 101, `1.5`, `abc`, vacío; doble envío; dos registros simultáneos del mismo ISBN (uno 201 y otro 409).
- Cuenta: nombre de 1, 120 y 121 caracteres y solo con espacios; correo con mayúsculas, con espacios alrededor, de 254 y 255; contraseña de 7, 8, 100 y 101; doble envío; dos altas simultáneas con el mismo correo.
- Sesión caducada a mitad del envío; sin red; respuesta del servidor que no cumple `ApiErrorSchema`.

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `app/libros/nuevo/page.tsx` · `catalog/ui/book-form.tsx` | frontend | Reglas 1–6; función pura `normalizeIsbn(value: string): string` (quita guiones y espacios) y `messageForBookError<T>(error: T): string` |
| `app/cuentas/nuevo/page.tsx` · `accounts/ui/member-form.tsx` | frontend | Reglas 7–11; `messageForMemberError<T>(error: T): string` |
| `app/cuentas/page.tsx` · `app/page.tsx` (+ un componente pequeño para el botón del personal en `/`) | frontend | Regla 12. **No se toca la barra de navegación** (`nav-bar.tsx` y su sesión son de F15) |
| Backend | — | Sin cambios |
| Pruebas | tests | `normalizeIsbn` (todos los bordes), `messageForBookError`/`messageForMemberError`, render inicial de ambos formularios (etiquetas, `autocomplete`, `inputmode`, radios solo Externo y Estudiante, ayuda de la contraseña), las dos páginas por rol (sin sesión redirige, prestatario ve el mensaje, personal ve el formulario), los botones de `/cuentas` y de `/` por rol (y que la búsqueda de `/` no cambie), y que `POST /api/books` y `POST /api/members` sigan como antes |

## Fuera de alcance
Editar o retirar un libro (F18–F19), categoría y año (F20), cargar copias digitales y contenido (F27), validar el dígito verificador del ISBN (F22), importar libros en lote, listar libros en una pantalla de personal, crear docentes o personal desde el mostrador, filtrar caracteres invisibles en nombres, títulos y autores (pendiente en `CLAUDE.md`), límite de tasa en estas rutas.

## Preguntas abiertas (resueltas)
1. **ISBN con guiones** (regla 3): el formulario los quita antes de enviar.
2. **Dónde están los enlaces** (regla 12): como botón dentro de cada página donde corresponden («Nueva cuenta» en `/cuentas`, «Registrar libro» en `/`); nada en la barra.
3. **Mensaje de éxito de la cuenta** (regla 10): se mantiene el texto propuesto; lo importante es que se vea bien: si no cabe bien a 360 px, se acorta sin perder la idea de que hay que entregarle el correo y la contraseña.
