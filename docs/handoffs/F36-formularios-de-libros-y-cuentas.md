## Entrega: orquestador · F36 (formularios para registrar libros y cuentas de mostrador)
**Hecho:**
- **`/libros/nuevo`** (solo personal): ISBN (el formulario quita guiones y espacios antes de validar y enviar), título, autor y ejemplares (1 a 100, inicia en 1). Éxito: «Se registró «Título» con N ejemplar(es).» (singular o plural según N), formulario limpio y foco en ISBN. 409 → «Ya existe un libro con ese ISBN.».
- **`/cuentas/nuevo`** (solo personal): nombre, correo, contraseña elegida por el personal y tipo de cuenta (Externo por defecto, Estudiante); no hay opción de docente ni de personal. Éxito: «Se creó la cuenta de X. Entrégale el correo y la contraseña; puede cambiarla después.». 409 → «Ya existe una cuenta con ese correo.».
- **Botones donde corresponden:** «Nueva cuenta» dentro de `/cuentas` y «Registrar libro» dentro de `/` (visible solo para personal, en un componente con `Suspense` y `connection()`; la búsqueda y el prerender de `/` no cambian). La barra de navegación no se toca (su rediseño es de F15).
- Piezas compartidas nuevas: `TextField` y `ButtonLink` en `app/shared/ui`.
- Sin cambios de backend ni de contrato: se reutilizan `POST /api/books` (F1) y `POST /api/members` (F3).
- Revisión de `security` (junto con F15): **Aprobado**, sin críticos, altos ni medios.

**Archivos:** `app/libros/nuevo/page.tsx`, `app/cuentas/nuevo/page.tsx`, `app/register-book-link.tsx`, `app/page.tsx`, `app/cuentas/page.tsx`, `app/features/catalog/ui/{book-form,request-error}`, `app/features/accounts/ui/member-form.tsx`, `app/shared/ui/{text-field,button-link}.tsx`; pruebas en `app/features/catalog/tests/{book-form-*,new-book-page,register-book-link,book-create-route}.test.ts`, `app/features/accounts/tests/{member-form-*,new-member-page,accounts-page-new-button,member-create-route}.test.ts` y `app/shared/tests/form-parts.test.ts`.

**Cómo verificar:** `npm run check:full` → 3748 pruebas en verde y build con `/libros/nuevo` y `/cuentas/nuevo`.

**Decisiones:** constan solo en `docs/specs/F36-formularios-de-libros-y-cuentas.md`.

**Pendiente / bloqueos:**
- **Probar en Vercel:** registrar un libro con un ISBN con guiones; repetirlo (409); buscarlo en `/`; crear una cuenta de mostrador y entrar con ella; repetir el correo (409); comprobar que un prestatario no ve ningún botón ni accede a las pantallas.
- **Revisión visual** de las dos pantallas y de los dos botones a 360, 768 y 1024 px, y del mensaje de éxito largo a 360 px (la persona pidió que se acorte si no se ve bien): sin pruebas de navegador.
- **ISBN-10 con "X" final:** un ISBN-10 real puede terminar en X, pero el contrato de F1 solo acepta dígitos y esos libros no se pueden registrar; tampoco se quita el guion Unicode («–»). Resolver en F22 (dígito verificador).
- **De `security` (Bajos, ya conocidos):** título, autor y nombre aceptan caracteres Unicode invisibles o de control (pendiente de `CLAUDE.md`); `POST /api/books` y `POST /api/members` sin límite de tasa; mejora menor: el ayudante de pruebas `linkTexts` (`tests/helpers/html.ts`) confunde `<article>` con enlaces (usar `<a(\s[^>]*)?>`).
- **Sin cubrir sin navegador:** el envío, el bloqueo de doble envío, los mensajes por campo, el foco tras éxito o error y el responsive.
