## Entrega: orquestador (frontend + pruebas + seguridad) · F33 Barra de navegación con sesión
**Hecho:**
- Barra de navegación en todas las páginas: «Biblioteca» siempre; «Cuentas» solo para `BIBLIOTECARIO` y `ADMINISTRADOR`; sin sesión «Ingresar»; con sesión nombre, rol en español y «Cerrar sesión».
- La sesión se lee en el servidor dentro de un `<Suspense>`; el HTML estático solo trae la barra mínima («Biblioteca»).
- Pantalla de error (`app/error.tsx`) con «Reintentar», sin mostrar el mensaje del error.
- `/cuentas` mantiene siempre el título «Cuentas» (también con el acceso denegado).
**Archivos:**
- `app/layout.tsx`, `app/session-nav.tsx`, `app/error.tsx`
- `app/features/accounts/ui/nav-bar.tsx`, `logout-button.tsx` (`role-labels.ts` ya existía)
- `app/features/accounts/tests/nav-bar.test.ts` (32 pruebas nuevas con `renderToStaticMarkup`)
**Cómo verificar:**
- `npm run check:full` → verde (385 pruebas, build correcto).
- Tras el build, `grep -E "Ingresar|Cerrar sesi|Cuentas" .next/server/app/index.html` → vacío.
- En el sitio: sin sesión se ve «Ingresar» y no «Cuentas»; con una estudiante se ven su nombre y «Cerrar sesión» sin «Cuentas»; con bibliotecaria o administrador, también «Cuentas»; «Cerrar sesión» vuelve a `/` mostrando «Ingresar».
**Decisiones:**
- El `catch` de `readNavUser` llama primero a `unstable_rethrow(error)`: sin eso se tragaba la señal de prerender de Next y la versión «sin sesión» quedaba guardada en el HTML estático para todos. Se detectó porque el log del build mostraba 8 veces «No se pudo leer la sesión»; ahora no aparece. Regla añadida a la spec F33 (regla 6) y a `docs/bootstrap.md`.
- Los fallos de lectura se ven como «sin sesión» pero se registran (solo el nombre del error).
- `NavBar` entrega solo la lista de enlaces; el `<nav aria-label="Principal">` lo pone el layout.
**Pendiente / bloqueos:**
- Revisión visual a 360, 768 y 1024 px (nombre largo con sesión, foco sobre el fondo azul oscuro, teclado, objetivos de 44 px) y forzar un fallo para ver `app/error.tsx`: nadie abrió un navegador.
- Observaciones de seguridad (severidad baja, ninguna bloquea):
  - Falta una prueba automática de `readNavUser` y del HTML estático tras el build.
  - `AccountList` recibe `Member[]` completo: si alguien le añade `"use client"`, los uid viajarían al navegador.
  - `handleError` registra el objeto de error completo en los 500.
  - El logout borra la cookie aunque falle la revocación (decisión consciente).
  - La barra hace dos lecturas de `members/{uid}` por navegación.
  - Sospecha sin demostrar: un nombre con caracteres Unicode de control (RTL) podría falsear la barra.
- No hay pruebas de `logout`, `getSessionUser`, `requireStaff` ni de las rutas HTTP (necesitan simular `next/headers` y Firebase).
**Dudas de la especificación:**
- La regla 5 (clic → `POST` → `/` y recarga) no se puede probar sin jsdom ni un `fetch` simulado; hacerlo exigiría añadir jsdom con un ADR.
