# ADR-0003 · Firebase (Authentication y Firestore) y Vercel Blob privado

- **Estado:** Aceptada
- **Fecha:** 2026-10-24
- **Quién decide:** la persona (profesor del proyecto)

## Contexto
La aplicación necesita identidades con recuperación de contraseña por correo (F16), persistencia de cuentas, libros y préstamos, y almacenamiento de los archivos Markdown de los libros digitales (F27). Se quiere usar solo planes gratuitos. Cloud Storage de Firebase exige el plan de pago por uso (Blaze), así que los archivos van en Vercel Blob. Regla 6 de `AGENTS.md`: este ADR es la justificación escrita de las dependencias nuevas.

## Decisión
| Necesidad | Servicio | Qué guarda |
| --- | --- | --- |
| Credenciales y correos (registro, ingreso, recuperar y cambiar contraseña) | **Firebase Authentication** (correo y contraseña, plan Spark) | Correo y contraseña. La app **nunca** guarda ni ve una contraseña. El `uid` de Firebase es el `member_id`. |
| Datos | **Firestore** (plan Spark) | Colecciones `members` (documento con id = `uid`: nombre, rol, estado, solicitud de docente), `books`, `loans`, `fines`, `reading_sessions`, `reading_incidents`. |
| Archivos Markdown de los libros | **Vercel Blob con un store privado** | Un archivo por libro, `books/{book_id}/content-{sufijo aleatorio}.md`. El documento del libro en Firestore guarda la ruta exacta. |

Reglas de uso:
- **Todo acceso a datos pasa por el servidor.** Firestore se usa con el SDK de administración (`firebase-admin`) y sus reglas de seguridad niegan toda lectura y escritura directa del cliente (`allow read, write: if false`). El SDK de cliente (`firebase`) se usa solo para ingresar, registrarse y pedir el correo de recuperación en el navegador.
- **El Markdown nunca se sirve por URL.** El store de Blob se crea con acceso **privado**; el servidor comprueba el préstamo digital activo, lee el archivo con `get(ruta, { access: 'private' })` del SDK `@vercel/blob` y entrega **una página por petición**. No se usan URL firmadas ni stores públicos, y la autorización se comprueba en la propia ruta (no en middleware). Las respuestas del lector llevan `Cache-Control: private, no-store`.
- **Reemplazar un contenido** (F27) crea un archivo nuevo con otro sufijo, actualiza la ruta en el libro y borra el anterior: así no se lee una versión vieja por la caché de Blob (que puede tardar hasta 60 s en propagar una sobrescritura).
- **Puerto `ContentStore`** (en `app/features/reader/server/repository.ts`): `put(book_id, markdown)` y `get(book_id)`. Implementaciones: memoria (pruebas) y Vercel Blob (real). Blob no tiene emulador, por eso las pruebas usan siempre la de memoria. Al subir un contenido (F27), primero se escribe el archivo y después se actualiza el libro; si lo segundo falla, se borra el archivo nuevo.
- **Sesión:** el navegador obtiene un ID token de Firebase y lo envía a `POST /api/auth/login`; el servidor lo verifica, crea una **cookie de sesión de Firebase** (`createSessionCookie`, `HttpOnly`, `Secure`, `SameSite=Lax`) y en cada petición la verifica (con comprobación de revocación). El **rol** y el estado salen del documento `members/{uid}` en Firestore, nunca de lo que mande el cliente (regla 4 de `AGENTS.md`). `shared/server` lo resuelve con `createSessionResolver`, una función pura a la que se inyectan la verificación de la cookie y la lectura de la cuenta; así se prueba sin Firebase.
- **Identificadores:** son texto (`IdSchema` es `z.string().min(1)`): el `uid` para las cuentas y el id de documento para el resto.
- **Administrador único:** el alta del `ADMINISTRADOR` crea, dentro de una transacción, el documento fijo `meta/admin` con `create()`, que falla si ya existe → `ConflictError`. El correo único lo garantiza Firebase Authentication.
- **Repositorios:** cada feature mantiene `repository.ts` (puertos asíncronos) y `repository.memory.ts` (pruebas), y añade `repository.firestore.ts` (real). Las pruebas usan las implementaciones en memoria y no tocan la red ni el proyecto real de Firebase.
- **Identidad:** `accounts` declara el puerto `IdentityProvider` (`createUser`, `deleteUser`, `verifyIdToken`, `createSessionCookie`) con implementación de Firebase Admin (`identity.firebase.ts`) y en memoria (`identity.memory.ts`, que además simula el inicio de sesión del cliente para las pruebas). Crear una cuenta crea primero el usuario en Authentication y luego el documento en Firestore; si el segundo paso falla, se borra el usuario.
- **Dependencias:** `firebase-admin` (servidor), `firebase` (cliente, solo Authentication) y `@vercel/blob` (versión 2.3 o superior, para stores privados; se instala con F27).
- **Secretos y variables** (los crea la persona en el archivo de entorno de la raíz; los agentes no lo leen ni lo crean; `.env.example` lista los nombres): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (servidor), `BLOB_READ_WRITE_TOKEN` (servidor; en Vercel el acceso se hace por OIDC al conectar el store al proyecto) y `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` (cliente; no son secretos). La clave de servicio nunca se sube a git ni se pega en un documento.
- **Datos de ejemplo:** `npm run seed` crea las cuentas de demostración (incluido el único administrador) y los libros de ejemplo en el proyecto de Firebase del archivo de entorno. **No borra nada**: lo que ya existe se omite con un aviso. Lo ejecuta la persona, no los agentes. Los libros de ejemplo no llevan contenido digital.

## Consecuencias
- Las contraseñas, el hash y el envío de correos salen del código de la app; desaparecen `app/shared/server/security/password.ts` y el secreto de sesión propio.
- Firestore no tiene restricciones únicas ni `CHECK`: la unicidad y los roles válidos se garantizan en el servicio, con transacciones y con los esquemas Zod; los repositorios de Firestore deben leer y validar cada documento con Zod antes de devolverlo.
- Dos proveedores, dos paneles y dos juegos de límites. Cuotas del plan gratuito que vigilar: Spark apaga el producto el resto del mes al pasar la cuota diaria de Firestore (lecturas y escrituras) y Blob bloquea el acceso (sin cobrar) al pasar sus límites mensuales de almacenamiento, operaciones y transferencia. Cada página del lector cuesta lecturas de Firestore y una lectura de Blob.
- El plan Hobby de Vercel es para uso no comercial, suficiente para un proyecto de clase.
- **Estado de Vercel Blob (2026-10-26):** el store privado ya está creado y conectado al proyecto. En el archivo de entorno local hay `BLOB_READ_WRITE_TOKEN` (validado por `npm run check:env`) y, además, el id del store. El código (`app/shared/server/env.ts`, `.env.example`) declara el token y, desde F27 (2026-10-25), también `BLOB_STORE_ID` (opcional, nombre confirmado por la persona). Los agentes no leen el archivo de entorno.
- Las consultas de Firestore son más limitadas que SQL (`LIKE`, uniones): la búsqueda de F2 (parcial, sin mayúsculas) se hace filtrando en el servidor sobre un campo normalizado del libro hasta que el catálogo crezca; si crece, se evalúa un buscador externo con otro ADR.
- La disponibilidad (`available`) y el cupo se calculan contando préstamos activos; los préstamos y devoluciones usan transacciones para no superar ejemplares ni cupo.
