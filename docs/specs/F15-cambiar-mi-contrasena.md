# F15 · Cambiar mi contraseña (y menú de navegación)

- **Estado:** Aprobada (la persona respondió las tres preguntas y aprobó, 2026-10-25; la pregunta 1 pidió un menú mejor y se concreta en las reglas 10–12)
- **Rol(es):** todos con sesión (`EXTERNO`, `ESTUDIANTE`, `DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR`), solo para su propia cuenta
- **Contrato afectado:** `app/features/accounts/schema.ts` (`ChangePasswordInputSchema`, solo para validar en el navegador). `app/shared/schema.ts` no cambia. **Enmienda a `docs/features.md`:** no existe `POST /api/me/password`; el cambio lo hace el SDK de cliente de Firebase, igual que F16.
- **Depende de:** `docs/specs/F3-F4-roles-y-cuentas.md`, `docs/specs/F10-F16-F17-autoservicio-de-cuentas.md` y `docs/specs/S1-endurecimiento-de-seguridad.md` (aprobadas); ADR-0003 (las credenciales viven en Firebase Authentication).
- **Decisiones:** `docs/frontend-rules.md` (responsive 360/768/1024 px, HTML semántico, paleta azul y blanco, WCAG 2.1 AA, Cache Components).

## Objetivo
Una persona con sesión cambia su propia contraseña desde una pantalla, comprobando la actual, y las sesiones abiertas antes del cambio dejan de valer. La barra de navegación se reorganiza en un menú más claro, con un menú de usuario donde vive «Cambiar contraseña».

## Qué hay hoy y qué cambia
- Las contraseñas solo existen en Firebase Authentication (nunca en nuestra base). El servidor **no puede comprobar** una contraseña: solo recibe un ID token ya emitido (F4). Por eso el cambio se hace en el navegador, con el SDK de cliente, como la recuperación (F16).
- El servidor verifica la cookie de sesión con `checkRevoked = true` (`verifySessionCookie(cookie, true)` en `app/shared/server/http.ts`). Firebase invalida los tokens de refresco de una cuenta al cambiar su contraseña, así que **las cookies emitidas antes del cambio dejan de valer** en la siguiente petición (de otros dispositivos y también la de este navegador). Por eso, tras cambiarla, esta pantalla vuelve a pedir una cookie con un ID token nuevo (regla 5).
- `auth-client.ts` ya tiene `signInAndGetIdToken`, `loginWithIdToken` y `closeClientSession`.

## Reglas de negocio
1. **`/contrasena`** (con sesión; sin sesión redirige a `/login`). Título «Cambiar contraseña». Lee la sesión y el correo de la cuenta (`members.get`) en el servidor, dentro de `<Suspense>` con `await connection()` (S1, regla 1); pasa el correo al formulario (no se muestra como campo editable). Si la cuenta no existe o está inactiva, el resolvedor ya la deja sin sesión.
2. **Formulario** (cliente): «Contraseña actual», «Nueva contraseña» (ayuda «Entre 8 y 100 caracteres») y «Confirmar nueva contraseña» (solo en el navegador); botón «Cambiar contraseña», deshabilitado mientras envía. `autocomplete` `current-password`, `new-password`, `new-password`. Sin opción de mostrar la contraseña en esta versión.
3. **Validación en el navegador** (`ChangePasswordInputSchema`): la actual de 1 a 100 caracteres, la nueva de 8 a 100, y la nueva **distinta** de la actual («La nueva contraseña debe ser distinta de la actual.»). Si la confirmación no coincide: «Las contraseñas no coinciden.»; en ambos casos no se llama a Firebase.
4. **Reautenticación:** `signInWithEmailAndPassword(auth, email, actual)` con el correo de la cuenta. Errores: credencial incorrecta (`auth/invalid-credential`, `auth/wrong-password`) → «La contraseña actual es incorrecta.»; `auth/too-many-requests` → «Demasiados intentos. Espera unos minutos e inténtalo de nuevo.»; otro → «No se pudo cambiar la contraseña. Inténtalo de nuevo.». La nueva contraseña no se envía a Firebase si esto falla.
5. **Cambio y renovación de la sesión:** con la sesión reautenticada: `updatePassword(user, nueva)` (errores: `auth/weak-password` → «La nueva contraseña es demasiado débil.»; `auth/requires-recent-login` → se repite una vez la reautenticación y, si vuelve a fallar, «Vuelve a ingresar e inténtalo de nuevo.»); después se **vuelve a iniciar sesión con la contraseña nueva** (`signInWithEmailAndPassword`) para obtener un ID token cuya autenticación es posterior al cambio (un token renovado con `getIdToken(true)` conserva la hora de la autenticación anterior y el servidor, que verifica las cookies con revocación, podría darlo por revocado), y con ese token se llama a `POST /api/auth/login` para recibir una cookie nueva; por último se cierra la sesión del SDK de cliente (`closeClientSession`). Si el cambio salió bien pero la cookie nueva falla: «Tu contraseña se cambió. Vuelve a ingresar con la nueva.» con un enlace a `/login`. Los campos se limpian al terminar.
6. **Éxito:** «Tu contraseña se cambió.» en `role="status"`, y el texto «Las sesiones abiertas en otros dispositivos se cerraron.» solo si la comprobación manual de la regla 9 lo confirma.
7. **Qué NO se hace:** no se guarda ni se registra ninguna contraseña (ni en el servidor ni en la consola); el campo no se conserva en el estado de React más allá del envío (campos no controlados, como en `login-form.tsx`); el personal no cambia la contraseña de otras personas; no hay envío de correo de aviso (el servidor no puede enviar correos).
8. **Cuenta inactiva:** una cuenta desactivada no tiene sesión (F14) y no llega a esta pantalla.
9. **Comprobación manual obligatoria tras desplegar** (la hace la persona; no se puede probar sin Firebase real): con dos navegadores con la misma cuenta, cambiar la contraseña en uno; en el otro, la siguiente petición debe pedir ingresar de nuevo; el navegador que cambió la contraseña sigue con sesión. Se anota el resultado en la nota de entrega.

### Menú de navegación (pregunta 1)
10. **Barra reorganizada** (`NavBar`, F33), con los mismos enlaces de hoy y la misma visibilidad por rol (nada cambia de destino ni de permiso):
    - «Biblioteca» (marca) a la izquierda, siempre visible.
    - **Enlaces de navegación** (los de cada rol: personal, prestatario): desde 768 px (`md:`) en línea; por debajo de 768 px dentro de un botón «Menú» que abre y cierra la lista (botón con `aria-expanded` y `aria-controls`; se cierra con Escape —y el foco vuelve al botón— y al activar un enlace).
    - **Área de sesión** a la derecha: sin sesión, «Ingresar»; con sesión, un botón con el nombre y el rol de la persona que abre el **menú de usuario** con «Cambiar contraseña» (→ `/contrasena`) y «Cerrar sesión» (el botón que ya existe). Mismo comportamiento que «Menú»: `aria-expanded`/`aria-controls`, Escape cierra y devuelve el foco al botón, activar una opción cierra, y un clic fuera lo cierra.
11. **Accesibilidad y diseño:** todo se usa con teclado (Tab, Enter, Espacio, Escape) en un orden lógico; objetivos de al menos 44 px; foco visible; un nombre de 120 caracteres se ajusta sin desbordar ni empujar la barra; a 360, 768 y 1024 px sin desplazamiento horizontal; colores solo de la paleta. Las listas van dentro del único `<nav aria-label="Principal">` del layout, con `<ul>`/`<li>`; ni `div` ni `span` llevan texto.
12. **Implementación libre dentro de las reglas del proyecto:** se puede usar un componente de cliente pequeño para el estado abierto o cerrado; la barra sigue leyendo la sesión en el servidor dentro de `<Suspense>` (F33) y no puede dejar de prerenderizar el resto de la página. Sin dependencias nuevas (ADR).

## Entradas y salidas
| Pieza | Entrada | Salida |
| --- | --- | --- |
| `/contrasena` | formulario `{ current_password, new_password }` + confirmación | «Tu contraseña se cambió.» o el mensaje de error de la regla 3, 4 o 5 |
| `ChangePasswordInputSchema` | `{ current_password: 1–100, new_password: 8–100 }`, la nueva distinta de la actual | validación en el navegador (no es una API) |

Errores esperados (en pantalla): los de las reglas 3, 4 y 5. El servidor solo interviene en `POST /api/auth/login`, que ya existe (límite 30/min por IP, F17).

## Autorización
Cualquier rol con sesión activa, solo para su propia cuenta (el correo sale de la sesión, no de la petición). Sin sesión: redirige a `/login`. No existe ninguna ruta que reciba el `member_id` de otra persona.

## Criterios de aceptación
- **Dado** una persona con sesión, **cuando** escribe su contraseña actual correcta y una nueva válida y distinta, **entonces** ve «Tu contraseña se cambió.», puede ingresar con la nueva y ya no con la anterior, y sigue con sesión en este navegador.
- **Dado** una contraseña actual incorrecta, **entonces** ve «La contraseña actual es incorrecta.» y la contraseña no cambia.
- **Dado** una nueva de 7 caracteres, **entonces** ve el error de validación sin llamar a Firebase; con 8 y con 100, se acepta; con 101, error.
- **Dado** una nueva igual a la actual, **entonces** ve «La nueva contraseña debe ser distinta de la actual.» sin llamar a Firebase.
- **Dado** una confirmación distinta, **entonces** ve «Las contraseñas no coinciden.» sin llamar a Firebase.
- **Dado** `auth/too-many-requests`, **entonces** ve el mensaje de demasiados intentos; con `auth/weak-password`, el de contraseña débil; con cualquier otro código, el genérico.
- **Dado** que el cambio salió bien pero la cookie nueva no se pudo emitir, **entonces** ve «Tu contraseña se cambió. Vuelve a ingresar con la nueva.» con el enlace a `/login`.
- **Dado** un visitante sin sesión, **cuando** abre `/contrasena`, **entonces** va a `/login`.
- **Dado** un cambio de contraseña, **entonces** una cookie de sesión emitida antes del cambio recibe 401 en la siguiente petición (comprobación manual, regla 9).
- **Dado** una persona con sesión, **cuando** abre el menú de usuario, **entonces** ve «Cambiar contraseña» y «Cerrar sesión»; Escape lo cierra y devuelve el foco a su botón; **dado** un visitante, **entonces** ve «Ingresar» y ningún menú de usuario.
- **Dado** un ancho de 360 px, **entonces** los enlaces de navegación están tras el botón «Menú» (cerrado al empezar); a 768 px y más, están visibles en línea; los enlaces son los mismos que antes para cada rol.
- **Dado** un nombre de 120 caracteres, **entonces** la barra no desborda a 360, 768 ni 1024 px.
- **Dado** `/contrasena` a 360, 768 y 1024 px, **entonces** no hay desplazamiento horizontal, los controles miden al menos 44 px y todo se usa con teclado; los mensajes van en `role="alert"`/`role="status"` enlazados con `aria-describedby`.

## Bordes
- Actual vacía; nueva de 0, 7, 8, 100 y 101 caracteres; nueva con espacios al inicio o al final (se conservan tal cual: no se recorta una contraseña); nueva igual a la actual con una mayúscula distinta (es distinta); confirmación vacía.
- Doble envío del formulario; sin red; token vencido a mitad del flujo (`auth/requires-recent-login`); cuenta con proveedor distinto de correo y contraseña (no existe en este proyecto).
- Cambio estando inactiva la cuenta o con la cookie ya vencida: la página redirige a `/login` antes de mostrar el formulario.

## Interfaz de módulos
| Pieza | Responsable | Firma / responsabilidad |
| --- | --- | --- |
| `accounts/schema.ts` | orquestador | `ChangePasswordInputSchema = { current_password: string 1–100, new_password: string 8–100 }` con la comprobación «distinta de la actual» (`refine` sin ternarios) y su tipo; solo se usa en el navegador |
| `accounts/ui/auth-client.ts` | frontend | `changePassword(email, current, next): Promise<void>` (reautenticar, `updatePassword`, renovar la cookie, cerrar la sesión del SDK; los errores de Firebase suben a quien llama) |
| `accounts/ui/change-password-form.tsx` · `app/contrasena/page.tsx` | frontend | Reglas 1–7; función pura `messageForPasswordError<T>(error: T): string` (mapeo de códigos de Firebase a mensajes) para probarla sin Firebase |
| `accounts/ui/nav-bar.tsx` (+ `session-nav.tsx`, `logout-button.tsx` y los componentes de menú nuevos que haga falta) | frontend | Reglas 10–12: menú «Menú» plegable bajo 768 px y menú de usuario con «Cambiar contraseña» y «Cerrar sesión». Las funciones y textos que ya prueban `nav-bar*.test.ts` se conservan cuando siguen valiendo; las pruebas que dependan de la estructura vieja se reescriben desde esta spec |
| Backend | — | Sin cambios: no hay ruta nueva |
| Pruebas | tests | `ChangePasswordInputSchema` (todos los bordes), `messageForPasswordError` (cada código de Firebase), render inicial del formulario y de la página (sin sesión → redirige), `changePassword` con `firebase/auth` simulado (orden: reautenticar → cambiar → renovar cookie → cerrar; errores en cada paso) |

## Fuera de alcance
Cerrar sesión en todos los dispositivos como acción aparte, buscador o iconos en la barra, un rediseño visual más allá de la estructura de las reglas 10–12, restablecer la contraseña de otra persona (la restablece ella con F16), mostrar u ocultar la contraseña, medidor de fortaleza, aviso por correo del cambio, cambiar el correo (no existe en el proyecto), caducidad de contraseñas.

## Preguntas abiertas (resueltas)
1. **Dónde está el enlace:** la persona pidió «hacer un menú mejor»; se concreta en las reglas 10–12 (menú plegable y menú de usuario con «Cambiar contraseña»).
2. **Sesiones de otros dispositivos:** se cierran al cambiar la contraseña (aprobado; se confirma a mano, regla 9).
3. **Pedir la contraseña actual:** sí, siempre.
