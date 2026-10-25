# ADR-0007 · Despliegue en Vercel y compatibilidad de módulos

- **Estado:** Aceptada
- **Fecha:** 2026-10-25
- **Quién decide:** la persona (profesor del proyecto)

## Contexto
La aplicación se publica en Vercel (plan Hobby, uso no comercial) desde la rama `main` de GitHub. El servidor de Vercel no ejecuta el código igual que un Node local: carga `firebase-admin` como módulo externo y no puede hacer `require()` de módulos ESM. `firebase-admin/auth` usa `jwks-rsa`, que por defecto trae `jose` v6 (solo ESM), y todas las páginas que tocan Firebase fallan con `ERR_REQUIRE_ESM` aunque en local funcionen.

## Decisión
- **Node 24.x** fijado en `package.json` (`"engines": { "node": "24.x" }`), la versión con la que se desarrolla y se prueba.
- **`jose` v4 (CommonJS) solo para `jwks-rsa`**, con un `overrides` de npm: `"overrides": { "jwks-rsa": { "jose": "^4.15.9" } }`. `jwks-rsa` solo usa `importJWK`, `exportSPKI`, `decodeJwt` y `decodeProtectedHeader`, que existen en la v4. Otro override fija `"@grpc/grpc-js": "^1.14.6"` (vulnerabilidades del cliente de Firestore que el proyecto no usa en el navegador).
- **Comprobación local equivalente a Vercel:** `NODE_OPTIONS=--no-experimental-require-module npx next start` tras `npm run build`. Si `/api/books` responde 200 así, el despliegue no fallará por esto.
- **Scripts de Node fuera de Next** (`seed`): se ejecutan con `tsx --conditions=react-server`, porque importan módulos con `import "server-only"`.
- **Variables de entorno:** las mismas de `.env.example` se crean en *Settings → Environment Variables* de Vercel, marcadas para Production; las `NEXT_PUBLIC_*` se leen al compilar, así que un cambio exige volver a desplegar. `FIREBASE_PRIVATE_KEY` se acepta con comillas envolventes y con `\n` literales (`normalizePrivateKey`).
- **Cookie de sesión:** `__Host-session` en producción (exige `Secure`, `Path=/` y sin `Domain`); `session` en desarrollo.
- **Vercel Blob** (store privado) se conecta al proyecto para F27; el acceso es por OIDC dentro de Vercel y por `BLOB_READ_WRITE_TOKEN` en local.
- **Diagnóstico:** cuando una configuración de Firebase falla, la app registra en el log un informe con ✓/✗ por variable (`EnvChecker`), nunca los valores.

## Consecuencias
- Cualquier dependencia nueva que sea solo ESM y la cargue una librería CommonJS externa puede reproducir el mismo error: se detecta con la comprobación local de arriba antes de desplegar.
- Los overrides son parte de la configuración: hay que revisarlos al actualizar `firebase-admin`.
- El plan Hobby limita el uso a fines no comerciales.
