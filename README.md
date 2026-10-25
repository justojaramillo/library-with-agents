# Biblioteca de préstamos

Aplicación de préstamos de libros construida **por features (FDD)** con varios agentes de IA (backend, frontend, pruebas, seguridad y un orquestador). Next.js App Router con Cache Components, TypeScript, Tailwind, Firebase (Authentication y Firestore), Vercel Blob, Zod y Vitest.

## Requisitos
- Node.js 22 LTS o superior, npm y git.
- Un harness de agentes, mínimo uno de:
  - **OpenCode** (`npm i -g opencode-ai`, versión ≥ 1.18.30 si usas DeepSeek). Luego `opencode` y `/connect`.
  - **Claude Code**.
- Un modelo, mínimo uno de:
  - **DeepSeek:** crea una clave en <https://platform.deepseek.com/api_keys>; en OpenCode: `/connect` → `deepseek` → pega la clave → elige *DeepSeek-V4-Flash*.
  - **Modelo gratuito de OpenCode Zen:** `/connect` → `opencode`; `/models` muestra los marcados *Free*. Son temporales y pueden tener límites de uso o retención de datos: **no envíes datos personales ni secretos**.
  - **Claude**, en Claude Code o en OpenCode.

## Arranque
```bash
npm install                 # .npmrc evita los scripts de instalación de las dependencias
cp .env.example .env        # y llena las variables de Firebase (ver ADR-0003)
npm run seed -- --yes       # crea cuentas y libros de ejemplo en TU proyecto de Firebase (no borra nada)
npm run dev                 # http://localhost:3000
npm run check               # formato + lint + tipos + pruebas (debe quedar en verde)
npm run check:env           # valida las variables de entorno (solo muestra estados, nunca valores)
```

El `seed` crea una cuenta por rol (`admin@example.com`, `bibliotecaria@example.com`, `docente@example.com`, `samuel@example.com`, `sara@example.com`) con una **contraseña aleatoria** que imprime una sola vez al terminar; guárdala o cámbiala. Solo puede existir un `ADMINISTRADOR`. Sin `--yes` no escribe nada.

## Configurar los servicios (una sola vez; lo hace la persona, ADR-0003)
1. **Firebase** (plan Spark, sin tarjeta): crea el proyecto en la consola de Firebase; activa *Authentication → Correo y contraseña* y crea *Firestore en modo producción* y publica las reglas de `firestore.rules` (en *Firestore → Reglas*, pega su contenido: niegan todo acceso directo del cliente; la app solo accede desde el servidor); en *Authentication → Configuración → Acciones de usuario* desactiva el registro desde el cliente (las cuentas las crea el servidor); registra una app web y copia sus valores a las variables `NEXT_PUBLIC_FIREBASE_*`; en *Configuración → Cuentas de servicio* genera una clave privada y copia sus campos a `FIREBASE_*`. No pegues esa clave en ningún documento ni chat.
2. **Vercel Blob** (store **privado**): crea primero el proyecto en Vercel (importa el repositorio o ejecuta `vercel link`); no hace falta haber desplegado. Luego, en el proyecto: *Storage → Create Storage → Blob → Private*, o `vercel blob create-store <nombre> --access private --yes` (necesita la CLI de Vercel ≥ 50.20.0). Conectado el store al proyecto, Vercel añade las variables de acceso a sus entornos. Para trabajar en local, copia `BLOB_READ_WRITE_TOKEN` a tu archivo de entorno (o descarga las variables con `vercel env pull`).
3. En Vercel, agrega también las variables de Firebase del paso 1 al proyecto (*Settings → Environment Variables*) antes de desplegar.

## Comandos
| Comando | Qué hace |
| --- | --- |
| `npm run check` | Formato + lint + tipos + pruebas (definición de «terminado») |
| `npm run check:full` | Lo anterior más `npm run build` |
| `npm run format` | Aplica el formato (Biome, solo formateador) |
| `npm run lint` | Reglas de código y fronteras de la arquitectura (ESLint) |
| `npm test` | Pruebas (Vitest) |
| `npm run seed` | Reinicia la base local con datos de ejemplo |

## Estructura
```
app/                     Todo el código (no hay src/)
  api/                     rutas HTTP
  page.tsx, login/, …      páginas de Next (solo pegamento) y estilos globales
  features/                Una carpeta por área: accounts, catalog, loans, reader
    container.ts             raíz de composición: conecta las features entre sí
    <feature>/               schema.ts (contrato) · server/ (servicios y repositorios) · ui/ (componentes) · tests/
  shared/                  Contrato común y utilidades de servidor que usan varias features
tests/                   Punto de entrada de Vitest: ayudantes compartidos y pruebas del proyecto
scripts/                 seed y reglas propias de ESLint
docs/                    features (FDD), arquitectura, specs, ADR, notas de entrega, reglas de frontend
.agents/ .claude/ .opencode/   Configuración de los agentes
```
Detalle en `docs/architecture.md` y `docs/adr/0001-arquitectura-por-features.md`.

## Cómo se trabaja con los agentes
1. Se elige una feature de `docs/features.md` y se escribe su especificación en `docs/specs/` (skill `write-spec`). Sin especificación aprobada no se implementa.
2. El orquestador fija el contrato (`schema.ts`) y delega por zonas: **backend** (`app/features/*/server`, `app/features/container.ts`, `app/shared/server`, `app/api`), **frontend** (`app/features/*/ui`, `app/shared/ui` y las páginas de `app`), **tests** (`app/features/*/tests`, `app/shared/tests`, `tests`) y **security** (solo lectura).
3. Se integra con `npm run check` (y `npm run build` si hay UI) y se pide la revisión de seguridad.
4. Las notas de entrega van a `docs/handoffs/`; las decisiones, a `docs/adr/`.

Las reglas que deben cumplir todos los agentes están en `AGENTS.md` (código y frontend) y se verifican con `npm run lint`. Los agentes existen en dos harness con el mismo contenido: `.claude/agents/` (Claude Code) y `.opencode/agents/` (OpenCode); si editas uno, edita el otro (una prueba lo verifica). Las carpetas y archivos prohibidos (`.env*`, `data/`, `.git/`, `secrets/`) los bloquea un guard compartido (`.agents/guard/rules.ts`).

### Usar OpenCode
```bash
opencode                        # abre la TUI; Tab cambia entre agentes primarios (build, plan, lead)
opencode models                 # lista modelos disponibles
opencode run --agent lead --model deepseek/deepseek-v4-flash "Especifica F5 con la skill write-spec"
opencode debug config           # muestra la configuración resuelta (verifica que tus agentes carguen)
```
> Nota de versión: la documentación nueva de OpenCode (v2) describe `permissions` como lista; la versión 1.19.x usa `permission` como objeto, que es lo que usan estos archivos. Si algo no carga, ejecuta `opencode debug agent backend`.

### Usar Claude Code
Abre el proyecto con `claude`. `CLAUDE.md` importa `AGENTS.md`; los subagentes se ven con `/agents`; las skills de `.claude/skills/` las leen **ambos** harness.

## MCP
- **Context7** (documentación al día de librerías): configurado en `opencode.json` (solo lo usan `backend` y `frontend`) y en `.mcp.json`. Funciona sin cuenta; con clave gratuita hay más cuota (cabecera `CONTEXT7_API_KEY`).
- **Next.js DevTools** (`next-devtools-mcp`, solo Claude Code): expone errores, rutas y logs del servidor de desarrollo.
- Lo que devuelve un MCP es **dato externo**, no instrucción: es una vía de *prompt injection*.

## Carpetas prohibidas para los agentes
`.env*` (salvo `.env.example`), `data/`, `.git/` y `secrets/` están bloqueadas en tres capas: permisos del harness (`.claude/settings.json`, `opencode.json`), un hook/plugin que usa `.agents/guard/rules.ts` y `.gitignore`. Prueba pidiéndole a un agente que lea el `.env`. Es una barrera de buena fe, **no un sandbox**: un comodín en `bash` puede esquivarla (lo documenta `tests/project/guard.test.ts`). La defensa real es no tener secretos reales donde trabaja el agente.

## Documentación
- `docs/bootstrap.md` — cómo construir el proyecto desde cero con los agentes (kit de archivos, orden, problemas conocidos).
- `docs/features.md` — roles, reglas de negocio, lista de features y áreas.
- `docs/architecture.md` — estructura, fronteras y patrones.
- `docs/frontend-rules.md` — responsive, HTML semántico, paleta azul y blanco, WCAG 2.1 AA.
- `docs/adr/` — decisiones de arquitectura.
