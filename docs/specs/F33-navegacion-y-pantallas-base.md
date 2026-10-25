# F33 · Barra de navegación con sesión y pantallas base (`/`, `/login`, `/cuentas`)

- **Estado:** Aprobada
- **Rol(es):** todos (la opción «Cuentas» solo para personal)
- **Contrato afectado:** ninguno (usa `Member`, `Role` y los esquemas existentes)
- **Decisiones:** ADR-0003 (sesión), `docs/frontend-rules.md` (responsive, HTML semántico, paleta, WCAG 2.1 AA)

## Objetivo
Que la persona vea en todas las páginas si tiene sesión, pueda ingresar y salir, y que cada pantalla base (`/`, `/login`, `/cuentas`) quede descrita para poder reconstruirla.

## Reglas de negocio
**Barra de navegación y estructura común** (`app/layout.tsx`, `app/features/accounts/ui/`)
1. Todas las páginas llevan: enlace «Saltar al contenido» (visible solo con el foco), `<header>` con `<nav aria-label="Principal">`, `<main id="contenido">` y `<footer>`. El idioma del documento es `es`. Título de la pestaña: «Biblioteca de préstamos».
2. La barra muestra siempre el enlace **Biblioteca** (a `/`).
3. **«Cuentas» solo existe para `BIBLIOTECARIO` y `ADMINISTRADOR`.** Sin sesión o con cualquier otro rol, el enlace no aparece. Es solo presentación: el servidor sigue exigiendo personal en `/cuentas` y en `/api/members`.
4. **Sin sesión:** a la derecha aparece el enlace **Ingresar** (a `/login`).
5. **Con sesión:** a la derecha aparecen el nombre de la persona, su rol en español (`ROLE_LABELS`) y el botón **Cerrar sesión**. El botón envía `POST /api/auth/logout` sin cuerpo, y al terminar (haya salido bien o no) lleva a `/` y recarga para que la barra se actualice.
6. La sesión y el nombre se leen en el servidor (`getSessionUser` y `members.get`); como leen cookies, van dentro de un `<Suspense>` (Cache Components). Mientras carga, la barra muestra solo **Biblioteca**; si la lectura de la cuenta falla, se muestra como sin sesión y el fallo se registra en el log (solo el nombre del error, nunca su mensaje). El `catch` que envuelve esas lecturas **debe llamar primero a `unstable_rethrow(error)`**: sin eso se traga la señal interna con la que Next marca la parte dinámica durante el prerender y la versión «sin sesión» quedaría guardada en el HTML estático para todos. Comprobación: tras `npm run build`, `.next/server/app/index.html` no contiene «Ingresar» ni «Cerrar sesión».
7. El rol que se muestra sale de Firestore, nunca de la cookie.

**`/` · Catálogo y búsqueda (F2)**
8. Título «Libros» y un formulario `GET /` con un campo «Título o autor» (`name="q"`, `type="search"`, conserva el valor) y el botón «Buscar»; funciona sin JavaScript del cliente.
9. El texto `q` se valida con `SearchBooksQuerySchema` (máx. 100 caracteres); si no es válido o no es un valor simple, se busca sin filtro.
10. Cada libro es un `<article>` en una lista: título, autor, ISBN y la disponibilidad: «Disponible: N de M ejemplares» (con icono de verificación) o «Agotado: 0 de M ejemplares» (con icono de cruz); nunca solo color. Sin resultados: «No hay libros que coincidan.»
11. La lista es de 1 columna a 360 px, 2 desde 768 px y 3 desde 1024 px.

**`/login` · Ingreso (F4)**
12. Título «Ingresar» y un formulario con «Correo» y «Contraseña» (ambos obligatorios, con `autocomplete`), y el botón «Entrar». Inicia sesión con el SDK de Firebase del navegador, envía el `id_token` a `POST /api/auth/login` y cierra la sesión del SDK de cliente.
13. Cualquier fallo de credenciales (incluido un correo mal formado) muestra «Credenciales inválidas»; un fallo de red u otro, «No se pudo ingresar»; si el servidor responde con error, se muestra su mensaje (validado con `ApiErrorSchema`). El mensaje va en un elemento con `role="alert"` enlazado con `aria-describedby`.
14. Al ingresar bien lleva a `/` y recarga.

**`/cuentas` · Lista de cuentas (F3, solo personal)**
15. Sin sesión redirige a `/login`. Con sesión de rol no personal muestra «Solo para el personal de la biblioteca.» (con `role="alert"`). El título de la página es siempre «Cuentas» (también en el mensaje de acceso denegado). Con personal muestra, por cada cuenta, nombre, correo y rol en español, sin ningún dato de contraseña; lista **todas** las cuentas, activas o no, sin distinguirlas. Misma rejilla de 1, 2 y 3 columnas.

16. **Errores de lectura.** Si Firestore falla al cargar una pantalla, se muestra una pantalla de error (`app/error.tsx`) con un mensaje en español y un botón «Reintentar»; la barra de navegación nunca rompe la página (regla 6). Una sesión que expira con la página abierta se nota en la siguiente navegación o recarga: la barra pasa a «sin sesión» y `/cuentas` redirige a `/login`.

## Entradas y salidas
| Pantalla | Entrada | Salida |
| --- | --- | --- |
| `/` | `?q=` (opcional) | lista de `Book` con `available` |
| `/login` | correo y contraseña | cookie de sesión y redirección a `/` |
| `/cuentas` | cookie de sesión | lista de `Member` · redirección · mensaje de acceso |
| Cerrar sesión | clic | `POST /api/auth/logout` y redirección a `/` |

## Autorización
Pública: `/` y `/login`. Personal: `/cuentas` (y el enlace). La comprobación real está en el servidor; la interfaz solo oculta lo que no corresponde.

## Criterios de aceptación
- **Dado** un visitante sin sesión, **cuando** abre cualquier página, **entonces** la barra muestra «Biblioteca» e «Ingresar» y no muestra «Cuentas».
- **Dado** una `ESTUDIANTE` con sesión, **entonces** la barra muestra su nombre, «Estudiante» y «Cerrar sesión», y no muestra «Cuentas».
- **Dado** un `BIBLIOTECARIO` o el `ADMINISTRADOR`, **entonces** la barra muestra además «Cuentas».
- **Dado** una persona con sesión, **cuando** pulsa «Cerrar sesión», **entonces** vuelve a `/`, la barra muestra «Ingresar» y `/cuentas` redirige a `/login`.
- **Dado** una `ESTUDIANTE` con sesión, **cuando** abre `/cuentas` escribiendo la dirección, **entonces** ve «Solo para el personal de la biblioteca.».
- **Dado** el catálogo con "Cien años de soledad" y "Rayuela", **cuando** busca «soledad» en `/`, **entonces** ve solo el primero con su disponibilidad.
- **Dado** credenciales erróneas, **cuando** envía el formulario de `/login`, **entonces** ve «Credenciales inválidas» y sigue en `/login`.
- **Dado** cualquier pantalla a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, el foco se ve, los controles miden al menos 44 px y se puede usar solo con teclado.

## Bordes
Sesión expirada con la página abierta · cuenta desactivada con cookie vigente (se ve como sin sesión) · nombre muy largo (se ajusta sin desbordar a 360 px) · `q` de 100 y 101 caracteres · `q` repetido en la URL (`?q=a&q=b`) · botón «Cerrar sesión» pulsado dos veces · JavaScript lento al cargar la barra.

## Interfaz de módulos (fija el trabajo en paralelo; no cambia ninguna regla)
| Pieza | Firma / responsabilidad |
| --- | --- |
| `app/layout.tsx` | Layout raíz: salto de contenido, `<header>` con la barra, `<main id="contenido">`, `<footer>`. Dentro de un `<Suspense>` monta `SessionNav` (regla 6) con la barra mínima («Biblioteca») como `fallback` |
| `app/session-nav.tsx` | Componente de servidor: lee `getSessionUser()` (`@/shared/server/http`) y `getContainer().members.get(member_id)`; pasa **solo props** a `NavBar`. Es la única pieza que toca el servidor |
| `app/features/accounts/ui/nav-bar.tsx` | `NavBar({ user: { name: string; role: Role } \| null })`: lista de enlaces según las reglas 2–5; no importa nada del servidor |
| `app/features/accounts/ui/logout-button.tsx` | Componente de cliente: `POST /api/auth/logout` sin cuerpo y luego `router.push("/")` + `router.refresh()` |
| `app/features/accounts/ui/role-labels.ts` | `ROLE_LABELS: Record<Role, string>` (se crea en esta feature): Externo/a, Estudiante, Docente, Bibliotecario/a, Administrador/a |
| `STAFF_ROLES` | de `@/shared/schema`; decide si se muestra «Cuentas» |

## Fuera de alcance
Pantallas de préstamos (F34, F35), formularios de alta (F36), gestión de personal (F37), registro público (F10) y cualquier opción de menú para prestatarios que aún no tiene página.

## Preguntas abiertas
Ninguna.
