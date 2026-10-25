# ADR-0008 · Límite de tasa en memoria y caché del catálogo público

- **Estado:** Aceptada
- **Fecha:** 2026-10-26
- **Quién decide:** persona (no el agente); la aprobación consta en `docs/specs/S1-endurecimiento-de-seguridad.md`

## Contexto
La búsqueda pública de libros lee toda la colección `books` en cada petición y la búsqueda de personas lee hasta 200 documentos. El plan Spark de Firebase permite 50 000 lecturas y 20 000 escrituras al día en todo el proyecto: un script (o una sesión robada) podría agotarlas y dejar la app sin servicio. No hay Redis ni otro almacén compartido, y las dependencias nuevas exigen un ADR (regla 6).

## Decisión
- **Catálogo público:** se cachea el resultado de buscar libros con `"use cache"` (Cache Components) con `revalidate: 60` y `expire: 120` (pasados 60 s la siguiente petición recibe una vez el dato anterior mientras se refresca; pasados 120 s espera el dato nuevo), etiquetado `books`; crear un libro, prestar y devolver invalidan la etiqueta, así que `available` solo se retrasa lo que tarde en llegar la invalidación. Reduce las lecturas de Firestore sin escribir nada.
- **Límite de tasa en memoria** (sin dependencias): ventana fija por clave en un `Map` del proceso. `GET /api/books` 60 peticiones por minuto por IP (cabecera `x-forwarded-for` que fija Vercel); `GET /api/members?q=` 30 por minuto por `member_id`. Al excederlo: `429` con `Retry-After`.
- **Cabeceras de seguridad** en `next.config.ts`: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS y una `Content-Security-Policy` (con `'unsafe-inline'` en scripts y estilos porque Next lo necesita sin nonces; `connect-src` con los dominios de Firebase Authentication; `frame-ancestors 'none'`).

## Alternativas consideradas
- Límite de tasa en Firestore o en Upstash/Redis — consume escrituras de la cuota gratuita o añade un servicio y una dependencia; se reconsidera si el uso crece.
- CSP con nonces — obliga a renderizar todas las páginas por petición y rompe el modelo de Cache Components.

## Consecuencias
- El límite en memoria es **por instancia**: en Vercel cada instancia tiene su propio contador, así que frena un script desbocado pero no es un tope global. Es una mitigación, no una garantía.
- Si la invalidación falla, el catálogo puede mostrar datos de hasta 120 s de antigüedad.
- La invalidación usa `revalidateTag("books", { expire: 0 })` desde `invalidateBooksCache()` del contenedor (las rutas solo pueden importar del contenedor).
- Hay que probar el ingreso (Firebase) tras cada cambio de la CSP: un dominio que falte rompe el login en producción.

## Limitaciones conocidas (revisión de seguridad de S1)
- En serverless, la caché en memoria de `use cache` puede no persistir entre peticiones y `revalidateTag` puede no llegar a otra instancia: hay que **medir en el despliegue** (contar las lecturas de Firestore con dos peticiones iguales). Si no hay aciertos, se valorará `use cache: remote` o `unstable_cache` en un ADR nuevo.
- `connect-src` lleva solo `identitytoolkit.googleapis.com` y `securetoken.googleapis.com`; el cliente de Firebase usa `inMemoryPersistence` sin ventanas emergentes (S1, regla 18). Si el proyecto activa reCAPTCHA Enterprise para correo y contraseña, habrá que añadir sus dominios (`www.google.com`, `www.gstatic.com/recaptcha`, `recaptchaenterprise.googleapis.com`).
- **El límite falla abierto fuera de Vercel:** sin una IP válida (cabecera ausente o con un valor que no es una IP) la clave es «desconocida» y no se limita. En Vercel la plataforma fija `x-vercel-forwarded-for`, así que no es explotable allí; si algún día se sirve fuera de Vercel, hay que usar un cubo compartido para «desconocida». Las IPv6 se agrupan por /64: quien tenga un /56 o un /48 dispone de muchos prefijos y puede rotar.
- La página `/?q=` también aplica el límite `catalogSearch` (no solo `GET /api/books`), porque cada texto distinto es una lectura completa del catálogo.
- HSTS lleva `includeSubDomains`: confirmar que no hay subdominios solo HTTP en el dominio propio.
