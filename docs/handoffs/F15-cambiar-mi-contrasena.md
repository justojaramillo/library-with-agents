## Entrega: orquestador · F15 (cambiar mi contraseña y menú de navegación)
**Hecho:**
- **`/contrasena`** (cualquier rol con sesión): contraseña actual, nueva (8 a 100, distinta de la actual) y confirmación. Todo en el navegador con el SDK de Firebase, sin ruta nueva: reautentica con la actual, cambia la contraseña (reintento único si Firebase pide autenticación reciente), vuelve a iniciar sesión con la nueva para obtener un token posterior al cambio, pide una cookie nueva con `POST /api/auth/login` y cierra la sesión del SDK. Si la contraseña cambió pero la cookie nueva falla, muestra «Tu contraseña se cambió. Vuelve a ingresar con la nueva.» con enlace a `/login`.
- **Menú de navegación:** «Biblioteca»; enlaces del rol (los mismos de antes) en línea desde 768 px y tras un botón «Menú» por debajo; a la derecha, «Ingresar» o un botón con nombre y rol que abre el menú de usuario con «Cambiar contraseña» y «Cerrar sesión». Escape cierra y devuelve el foco, activar una opción cierra, un clic fuera cierra.
- Contrato: `ChangePasswordInputSchema` (solo para validar en el navegador). Enmienda a `docs/features.md`: no existe `POST /api/me/password`.
- Revisión de `security` (junto con F36): **Aprobado**, sin críticos, altos ni medios.

**Archivos:** `app/contrasena/page.tsx`, `app/features/accounts/ui/{change-password-form,nav-menu,nav-bar,logout-button,auth-client}`, `app/features/accounts/schema.ts`; pruebas en `app/features/accounts/tests/{change-password-*,nav-bar-menu}.test.ts` y el ajuste de `nav-bar.test.ts`.

**Cómo verificar:** `npm run check:full` → 3748 pruebas en verde y build con `/contrasena`.

**Decisiones:** constan solo en `docs/specs/F15-cambiar-mi-contrasena.md`.

**Pendiente / bloqueos:**
- **Comprobación manual obligatoria con Firebase real (regla 9 de la spec):** con dos navegadores con la misma cuenta, cambiar la contraseña en uno; el otro debe pedir ingresar de nuevo en su siguiente petición; el que cambió la contraseña conserva su sesión. Si en este navegador la sesión se pierde, el flujo de renovación (re-inicio de sesión con la contraseña nueva) falló. Si todo sale bien, se puede añadir al mensaje de éxito la frase sobre las otras sesiones.
- **Revisión visual** de `/contrasena` y de la barra a 360, 768 y 1024 px (menú «Menú», menú de usuario, nombre largo, foco, teclado, Escape, clic fuera): sin pruebas de navegador (el proyecto no tiene jsdom ni testing-library).
- **De `security` (Bajos):** tres copias casi iguales de «leer el error validado» (`auth-client.ts`, `accounts/ui/request-error.ts`, `catalog/ui/request-error.ts`): unificar en `app/shared/ui`; la validación del formulario (`validateFields`) no está exportada y no se prueba aparte.
- **Dudas de la especificación:** si falla el re-inicio de sesión con la contraseña nueva, el código lanza `SessionRenewalError` (la contraseña ya cambió).
