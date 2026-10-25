## Entrega: orquestador · F10 + F16 + F17 (autorregistro, recuperar contraseña, límite de intentos)
**Hecho:**
- **F10:** `POST /api/auth/register` (pública, origen → límite 10/h por IP → validación → `members.register`, 201) y pantalla `/registro` (nombre, correo, contraseña con confirmación, «Soy» Externo/Estudiante, ingreso automático al crear la cuenta). El 409 por correo repetido usa el mensaje de la spec.
- **F16:** pantalla `/recuperar` con `sendPasswordResetEmail` del SDK de cliente (sin ruta propia); mismo mensaje exista o no la cuenta; `messageForResetError` pura y probada.
- **F17:** límite de 30/min por IP en `POST /api/auth/login`; `/login` traduce `auth/too-many-requests` (con enlace a `/recuperar`) y añade enlaces a `/recuperar` y `/registro`. El bloqueo por contraseñas erróneas es el de Firebase (el servidor no ve esos intentos).
- Contrato: `ForgotPasswordInputSchema`; el correo admite como máximo 254 caracteres en los tres esquemas.
- **Aviso de la CSP por Zod en el navegador:** `client-setup` fija `z.config({ jitless: true })`; los módulos que alcanza el navegador lo importan antes que cualquier esquema (prueba de proyecto `tests/project/client-setup-order.test.ts`).
- Revisión de `security`: sin críticos ni altos.

**Archivos:** `app/api/auth/{register,login}/route.ts`, `app/shared/server/security/rate-limit.ts`, `app/features/accounts/server/{member-service,identity.firebase,identity.memory}.ts`, `app/features/accounts/schema.ts`, `app/features/accounts/ui/{auth-client,register-form,forgot-password-form,login-form}.tsx|ts`, `app/registro/`, `app/recuperar/`, `app/shared/ui/client-setup.tsx`, `app/layout.tsx`, `app/features/loans/ui/*` (import de `client-setup`); pruebas en `app/features/accounts/tests`, `app/shared/tests`, `tests/project`, `tests/helpers/html.ts`.

**Cómo verificar:** `npm run check:full` → 1452 pruebas en verde y build con `/registro`, `/recuperar` y `/login`.

**Decisiones:** constan solo en `docs/specs/F10-F16-F17-autoservicio-de-cuentas.md`.

**Pendiente / bloqueos:**
- **En la consola de Firebase (lo hace la persona):** confirmar el estado de «Email enumeration protection» y de «Enable create (sign-up)» (el registro directo contra la API de Firebase evita nuestro límite); revisar en *Authentication → Plantillas* que «Restablecer contraseña» esté en español y que el dominio de la app figure entre los autorizados.
- **Probar tras desplegar:** `/registro` → ingreso automático; `/recuperar`; que la consola no muestre el aviso de eval de la CSP en `/login`, `/registro`, `/recuperar` y `/prestamos`.
- Informe de `security` (Medios, sin cambio de código ahora): el límite de tasa es por instancia (mejor esfuerzo); correo sin verificar → ocupación previa de un correo ajeno (reabrir la verificación antes de F11–F12 y de la Ola 3); registro directo contra Firebase. Bajos: expulsión del `Map` entre cubos distintos (sin prueba), IP compartida (NAT) con 10 registros/h, cuerpo sin tope propio (`content-length`), normalización antes de validar el correo (Kelvin), `login-form` no deshabilita el botón mientras envía.
- Prueba pendiente: que el enlace a `/recuperar` aparezca solo con `offerRecovery` (hay que exportar `ErrorMessage`).
- Lo ya anotado para la semilla de estudiantes sigue pendiente en `CLAUDE.md`.

**Dudas de la especificación:** texto exacto de los enlaces de `/recuperar` y de «Ya tienes cuenta» (solo se probaron los destinos); atributos HTML de longitud en los formularios.
