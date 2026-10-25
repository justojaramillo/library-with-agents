# F3/F4 · Cuentas, roles e ingreso

- **Estado:** Aprobada
- **Rol(es):** todos
- **Contrato afectado:** `app/shared/schema.ts`, `app/features/accounts/schema.ts`, `app/features/loans/schema.ts` (`LOAN_RULES.loanDaysByRole`)
- **Decisiones:** ADR-0003 (Firebase), ADR-0004 (roles), ADR-0005 (convenciones y `snake_case`)

## Objetivo
Que la biblioteca tenga cinco roles (`EXTERNO`, `ESTUDIANTE`, `DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR`), que el personal pueda crear cuentas de mostrador (F3) y que cualquier cuenta activa pueda ingresar con correo y contraseña (F4).

## Reglas de negocio
1. `register` solo acepta `role` = `EXTERNO` (valor por defecto) o `ESTUDIANTE`. Con `DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR` o cualquier otro valor, falla la validación (400 en HTTP).
2. `provision` crea una cuenta con cualquier rol. No lo llama ninguna ruta HTTP; lo usan `npm run seed` y, más adelante, F13.
3. El correo se guarda en minúsculas y es único (`ConflictError`; lo garantiza Firebase Authentication); la contraseña tiene entre 8 y 100 caracteres y la guarda solo Firebase Authentication: la app no guarda, hashea ni devuelve contraseñas.
4. El ingreso (F4) funciona para los cinco roles y devuelve el rol; correo inexistente, contraseña errónea y cuenta inactiva dan el mismo error `Credenciales inválidas`.
5. Registrar libros (F1), registrar cuentas (F3) y listar cuentas exigen **personal** (`BIBLIOTECARIO` o `ADMINISTRADOR`): sin sesión → 401; con otro rol → 403.
6. Un bibliotecario que envía `role: "BIBLIOTECARIO"` (o `ADMINISTRADOR`) en `POST /api/members` recibe 400, no 201.
7. La sesión es la cookie de sesión de Firebase (`HttpOnly`, `Secure`); el servidor la verifica en cada petición y obtiene `member_id` (el `uid`) y el `role` desde el documento de la cuenta en Firestore, nunca del cliente. Una cookie alterada, expirada o de una cuenta inactiva no da sesión.
8. `LOAN_RULES.loanDaysByRole` = `{ EXTERNO: 15, ESTUDIANTE: 20, DOCENTE: 30 }`; no existe un plazo único.
9. Todos los campos de los `schema.ts` que viajan por el cable están en `snake_case`.
10. Solo se persisten los cinco roles: se validan al escribir y al leer cada documento de cuenta.
11. **Hay un solo `ADMINISTRADOR`.** `provision` con `role: "ADMINISTRADOR"` cuando ya existe uno lanza `ConflictError`, y la persistencia lo garantiza creando, en una transacción, el documento fijo `meta/admin` (si ya existe, falla).

## Entradas y salidas
| Operación | Entrada | Salida / error |
| --- | --- | --- |
| `register` | `CreateMemberInput` | `Member` · `ConflictError` si el correo existe · error de validación si el rol no es seleccionable |
| `provision` | `ProvisionMemberInput` | `Member` · `ConflictError` (correo repetido o segundo administrador) |
| `login` | `SessionLoginInput` (`id_token` de Firebase, obtenido por el cliente con correo y contraseña) | `Member` y la cookie de sesión · `UnauthorizedError` |
| `POST /api/members` | `CreateMemberInput` | 201 `Member` · 400 · 401 · 403 · 409 |
| `GET /api/members` | — | 200 `Member[]` · 401 · 403 |
| `POST /api/books` | `CreateBookInput` | 201 `Book` · 400 · 401 · 403 · 409 |

## Autorización
Personal: F1, F3, listar cuentas. Público: F2, ingreso.

## Criterios de aceptación
- **Dado** un formulario con rol `DOCENTE`, **cuando** se registra, **entonces** falla la validación y no se crea la cuenta.
- **Dado** un formulario sin `role`, **cuando** se registra, **entonces** la cuenta queda `EXTERNO`.
- **Dado** una cuenta `ESTUDIANTE`, **cuando** se registra, **entonces** queda `ESTUDIANTE` y `active` = verdadero.
- **Dado** una cuenta creada con `provision` por cada uno de los cinco roles, **cuando** ingresa con su contraseña, **entonces** `login` devuelve ese rol.
- **Dado** una cuenta inactiva, **cuando** ingresa, **entonces** `Credenciales inválidas`.
- **Dado** `LOAN_RULES`, **entonces** los plazos son 15, 20 y 30 días para externo, estudiante y docente.
- **Dado** el contrato, **entonces** ninguna clave de los esquemas exportados de los `schema.ts` tiene mayúsculas.
- **Dado** una cookie de sesión válida, **cuando** se verifica, **entonces** devuelve `{ member_id, role }` con el rol vigente de Firestore; si está alterada, expirada o la cuenta está inactiva, devuelve `null`.
- **Dado** que ya existe un `ADMINISTRADOR`, **cuando** se llama a `provision` con otro `ADMINISTRADOR` (correo distinto), **entonces** `ConflictError` y no se crea la cuenta.
- **Dado** que ya existe un `ADMINISTRADOR`, **cuando** se provisionan otros roles, **entonces** se crean con normalidad.

## Fuera de alcance
F10–F13 (autorregistro, solicitud de docente, creación de bibliotecarios), préstamos (F5–F8) y el lector.

## Preguntas abiertas
Ninguna.
