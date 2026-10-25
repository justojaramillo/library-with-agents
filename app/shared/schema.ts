import { z } from "zod";

/**
 * Convención del cable (ADR-0005): todo campo que viaja entre backend y frontend
 * (cuerpos de petición y de respuesta) usa snake_case. Los esquemas de este directorio
 * son ese formato; una prueba (`tests/project/contracts-style.test.ts`) lo vigila.
 */

/** Identificadores: texto no vacío (ADR-0003). Para las cuentas es el `uid` de Firebase; para lo demás, el id de documento de Firestore. */
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/, "El id no puede llevar «/»");
export type Id = z.infer<typeof IdSchema>;

/** Roles del sistema (ADR-0004, `docs/features.md`). */
export const ROLES = ["EXTERNO", "ESTUDIANTE", "DOCENTE", "BIBLIOTECARIO", "ADMINISTRADOR"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Roles que piden libros prestados. Cada uno tiene su propio plazo (`LOAN_RULES.loanDaysByRole`). */
export const BORROWER_ROLES = ["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const;
export type BorrowerRole = (typeof BORROWER_ROLES)[number];

/** Personal de la biblioteca. */
export const STAFF_ROLES = ["BIBLIOTECARIO", "ADMINISTRADOR"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Roles que una persona puede elegir al registrarse. `DOCENTE` exige verificación de un
 * bibliotecario; `BIBLIOTECARIO` solo lo crea un administrador; `ADMINISTRADOR` no se crea por la web.
 */
export const SELECTABLE_ROLES = ["EXTERNO", "ESTUDIANTE"] as const;
export const SelectableRoleSchema = z.enum(SELECTABLE_ROLES);
export type SelectableRole = z.infer<typeof SelectableRoleSchema>;

/** Un problema de validación: en qué campo (partes de la ruta) y qué pasó. */
export const ApiIssueSchema = z.object({
  path: z.array(z.string()),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof ApiIssueSchema>;

/** Cuerpo de toda respuesta de error de la API (`handleError`). `issues` solo aparece en los 400 de validación. */
export const ApiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(ApiIssueSchema).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Identidad autenticada que viaja en la sesión (cookie firmada). */
export const SessionUserSchema = z.object({
  member_id: IdSchema,
  role: RoleSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
