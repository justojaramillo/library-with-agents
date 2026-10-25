# Construir el proyecto desde cero

Guía para copiar este repositorio a un proyecto vacío y que los agentes lo construyan feature por feature. Lo que **no** se copia es el código de las features (`server/`, `ui/`, rutas, `seed`): ese lo escriben los agentes a partir de las specs aprobadas.

## 1. Lo que hace la persona (los agentes no pueden)
1. **Node 24.x** y npm instalados (`node -v`). Ver ADR-0007.
2. **Proyecto de Firebase** (plan Spark, sin tarjeta): en la consola, *Authentication → Get started → Correo/contraseña* activado; *Firestore Database* creada en modo producción con las reglas de `firestore.rules`; una app web registrada; una clave de cuenta de servicio generada. Desactiva el registro desde el cliente (*Authentication → Configuración → Acciones de usuario*).
3. **Archivo de entorno** `.env` en la raíz a partir de `.env.example`, con las variables de Firebase. Los agentes no lo leen ni lo crean; se valida con `npm run check:env` (muestra estados, nunca valores).
4. **GitHub y Vercel:** repositorio nuevo, proyecto importado en Vercel, las mismas variables en *Settings → Environment Variables* (Production) y, para F27, un store de **Vercel Blob privado** conectado al proyecto.
5. **Aprobar las specs** antes de pedir cada paso: solo la persona cambia el encabezado de una spec de *Borrador* a *Aprobada* (los agentes se detienen si no lo está). Para el paso 1 hay que aprobar `F0-base-del-proyecto`; para el paso 4, `F33-navegacion-y-pantallas-base`.

## 2. Kit de archivos a copiar
| Qué | Archivos | Por qué se copia tal cual |
| --- | --- | --- |
| Reglas e instrucciones | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/` | Son la fuente de verdad (features, arquitectura, ADR, specs, reglas de frontend) |
| Agentes y guard | `.claude/`, `.opencode/`, `.agents/`, `opencode.json`, `.mcp.json` | Definen los roles, las zonas de archivos y el bloqueo de carpetas prohibidas |
| Puertas de calidad | `package.json` (con `engines` y `overrides`), `package-lock.json`, `.npmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `biome.json`, `vitest.config.mts`, `scripts/eslint/` | Son las reglas que hacen cumplir `npm run check`; reescribirlas cambiaría las reglas |
| Pruebas del proyecto | `tests/project/`, `tests/helpers/contrast.ts` | Guard, consistencia de agentes, estilo de contratos y contraste de la paleta |
| Contratos | `app/shared/schema.ts`, `app/features/*/schema.ts` | Son el acuerdo entre agentes (solo el orquestador los cambia); `tests/project/contracts-style.test.ts` los vigila |
| Estilos base | `app/globals.css` (tokens de la paleta) | La paleta y el foco visible están fijados por `docs/frontend-rules.md` |
| Seguridad de datos | `firestore.rules`, `.env.example`, `.gitignore` | Niegan el acceso directo a Firestore y evitan subir secretos |

Después: `npm install` (el `.npmrc` desactiva los scripts de instalación de las dependencias) y `npm run check`, que **ya pasa** con solo el kit (pruebas del proyecto: guard, agentes, contratos y paleta). Es la línea base: cada paso debe dejarlo en verde.

> **Aviso:** el hook del guard (`.claude/settings.json`) llama a `node_modules/.bin/tsx`. Hasta ejecutar `npm install` no existe, y un fallo del hook podría dejar a los agentes sin esa protección. Instala dependencias **antes** de abrir una sesión de agentes.

## 3. Orden de construcción
El orquestador sigue la skill `feature-workflow` (especificar → contrato → delegar por zonas → integrar → revisar → registrar). Cada paso termina en `npm run check:full` en verde.

| Paso | Spec | Qué se construye | Estado de la spec |
| --- | --- | --- | --- |
| 1 | `F0-base-del-proyecto` (reglas 1–15, 18–20) | Capa compartida: errores y HTTP, origen, sesión, Firebase, entorno y `check:env` (sin contenedor ni `seed`: necesitan servicios) | Aprobada |
| 2 | `F1-registrar-libro`, `F2-buscar-libros` | Catálogo (servicio, repositorios memoria y Firestore, rutas) | Aprobada |
| 3 | `F3-F4-roles-y-cuentas`, y al cerrarlo F0 (reglas 16–17) | Cuentas, cinco roles, ingreso, administrador único; al cerrarlo, el contenedor (`container.ts`), las rutas HTTP, el `seed` y `makeWorld` (reglas 16, 17 y 20) | Aprobada |
| 4 | `F33-navegacion-y-pantallas-base` | Barra de navegación y pantallas `/`, `/login`, `/cuentas` | Aprobada |
| 5 | por escribir (`write-spec`) | Ola 1: F5–F8 préstamos, F34–F35 pantallas | Falta |
| 6 | por escribir | Olas 2–5 según `docs/features.md` | Falta |

Orden dentro de los pasos 2 y 3: (a) servicios y repositorios de catálogo y de cuentas en paralelo (`backend`), con sus pruebas (`tests`); (b) el contenedor y las rutas HTTP, que necesitan los servicios; (c) el `seed` y `makeWorld`; (d) revisión de `security`.

Para cada paso, el orquestador (la sesión principal) hace:
1. Leer la spec y pedirle a la persona que la apruebe si está en *Borrador*.
2. Delegar: `backend` (servicios, repositorios, rutas, contenedor), `frontend` (pantallas y componentes), `tests` (pruebas desde la spec, nunca desde el código); luego `security` revisa en solo lectura.
3. Integrar con `npm run check:full` y, si hay despliegue, comprobar con `NODE_OPTIONS=--no-experimental-require-module npx next start` que `/api/books` responde 200 (ADR-0007).
4. Registrar la nota de entrega en `docs/handoffs/` y, si hubo una decisión, un ADR.

Primer mensaje sugerido para el orquestador:
> Lee `AGENTS.md`, `docs/bootstrap.md` y `docs/features.md`. Vamos a construir el proyecto desde cero. Empieza por el paso 1 (`docs/specs/F0-base-del-proyecto.md`, sin el contenedor ni el `seed`): confirma que el kit está copiado, corre `npm run check` como línea base y delega según `feature-workflow`. Cuando termines el paso, verifica el entorno con `npm run check:env` (se construye en este paso). No ejecutes `npm run seed`.

## 4. Verificación final
- `npm run check:full` en verde.
- `npm run check:env` válido y la comprobación de producción local (ADR-0007) con 200.
- La persona ejecuta `npm run seed -- --yes` y prueba el ingreso con una cuenta de demostración (la contraseña aleatoria que imprime el seed).
- Despliegue en Vercel y revisión de `/`, `/login` y `/cuentas` a 360, 768 y 1024 px.

## 5. Problemas conocidos
| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| `CONFIGURATION_NOT_FOUND` al sembrar | Authentication no está inicializado | Consola de Firebase → Authentication → *Get started* y activar correo/contraseña |
| El catálogo se queda en «Cargando…» en Vercel, log con `ERR_REQUIRE_ESM` | `jwks-rsa` carga `jose` v6 (solo ESM) | El override de `package.json` (ADR-0007) |
| «Configuración de Firebase incompleta» en el log | Faltan variables en Vercel o la clave está mal pegada | Revisar el informe ✓/✗ del log y volver a desplegar |
| `npm run seed` falla con `server-only` | Falta `--conditions=react-server` | Usar el script `seed` de `package.json` |
| Un hook de guard falla al empezar | Aún no se instalaron dependencias | `npm install` |
| El ingreso funciona pero nada cambia en pantalla | Falta F33 | Implementar la spec F33 |
| Tras `npm run build` el HTML estático de `/` contiene «Ingresar» o el log del build dice «No se pudo leer la sesión» | Un `catch` se traga la señal de prerender de Next | Llamar a `unstable_rethrow(error)` primero en todo `catch` que envuelva `cookies()` o lecturas de sesión (F33, regla 6) |
| Una prueba de componente de React no corre | Vitest usa entorno `node` y solo incluye `*.test.ts`; no hay jsdom | Probar componentes con `renderToStaticMarkup` y `createElement` (sin dependencias nuevas) |
