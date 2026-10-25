# ADR-0004 · Cinco roles con plazos y creación restringida

- **Estado:** Aceptada
- **Fecha:** 2026-10-24
- **Quién decide:** la persona (profesor del proyecto)

## Contexto
La biblioteca necesita distinguir a quién presta, por cuánto tiempo y con qué cupo, y controlar quién puede dar de alta al personal.

## Decisión
Roles: `EXTERNO`, `ESTUDIANTE`, `DOCENTE`, `BIBLIOTECARIO`, `ADMINISTRADOR` (`app/shared/schema.ts`).
- Plazo de préstamo: externo 15 días, estudiante 20, docente 30 (`LOAN_RULES.loanDaysByRole`). Cupo de préstamos activos: 3, 3 y 5 (`maxActiveLoansByRole`). Renovaciones: 2, 2 y 3 (`maxRenewalsByRole`).
- El personal (`BIBLIOTECARIO`, `ADMINISTRADOR`) gestiona préstamos de otros y no pide libros prestados con su cuenta.
- En el registro solo se eligen `EXTERNO` o `ESTUDIANTE` (`SELECTABLE_ROLES`).
- `DOCENTE` requiere verificación de un bibliotecario (F11–F12).
- `BIBLIOTECARIO` solo lo crea un `ADMINISTRADOR` (F13); un bibliotecario no puede crear, ascender ni aprobar personal.
- `ADMINISTRADOR` se crea con un script de arranque (`npm run seed`), nunca por la web, y **hay uno solo**: el alta crea en una transacción el documento fijo `meta/admin` (ADR-0003) y `provision` rechaza un segundo con `ConflictError`.
- El servicio expone `register` (roles seleccionables) y `provision` (cualquier rol, solo para scripts y para servicios que ya validaron al actor). Ninguna ruta HTTP acepta un rol arbitrario del cliente.
- «Personal» = `BIBLIOTECARIO` o `ADMINISTRADOR` (`STAFF_ROLES`); en el servidor se exige con `requireStaff`.

## Alternativas consideradas
- Un solo rol `SOCIO` con un campo «tipo»: mezcla permisos con plazos y obliga a validar dos campos a la vez.
- Permisos por lista (RBAC completo): excesivo para cinco roles fijos.

## Consecuencias
- Solo se persisten los cinco roles: lo validan los esquemas Zod al escribir y al leer cada documento de `members`.
- Los plazos, cupos y renovaciones dependen del rol vigente al prestar; un cambio de rol posterior no recalcula préstamos hechos.
