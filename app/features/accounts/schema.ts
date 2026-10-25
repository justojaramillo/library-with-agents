import { z } from "zod";
import { IdSchema, RoleSchema, SelectableRoleSchema } from "@/shared/schema";

/** F4 · Ingreso con correo y contraseña — entrada. */
export const LoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(100),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

/**
 * F4 · Ingreso en el servidor — entrada. La persona ya inició sesión con el SDK de cliente de Firebase
 * (correo y contraseña) y envía su ID token; el servidor lo verifica y crea la cookie de sesión (ADR-0003).
 */
export const SessionLoginInputSchema = z.object({
  id_token: z.string().min(1).max(4096),
});
export type SessionLoginInput = z.infer<typeof SessionLoginInputSchema>;

const MemberBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(8).max(100),
});

/**
 * F3 / F10 · Registrar una cuenta — entrada. El rol solo puede ser uno seleccionable
 * (`EXTERNO` o `ESTUDIANTE`); cualquier otro valor se rechaza con 400.
 */
export const CreateMemberInputSchema = MemberBaseSchema.extend({
  role: SelectableRoleSchema.default("EXTERNO"),
});
export type CreateMemberInput = z.infer<typeof CreateMemberInputSchema>;

/**
 * Alta con cualquier rol. SOLO para scripts de arranque (`npm run seed`) y para los servicios
 * que ya comprobaron quién es el actor (F13). Ninguna ruta HTTP lo recibe directamente del cliente.
 */
export const ProvisionMemberInputSchema = MemberBaseSchema.extend({
  role: RoleSchema,
});
export type ProvisionMemberInput = z.infer<typeof ProvisionMemberInputSchema>;

/** Lo que se devuelve al exterior: NUNCA incluye el hash de la contraseña. */
export const MemberSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  active: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

/**
 * F34 · Buscar personas (para elegir a quién prestar) — entrada de `GET /api/members?q=&limit=&lendable=`.
 * `q`: de 2 a 100 caracteres y al menos una palabra de 2 o más letras o dígitos. `lendable=true` limita
 * a cuentas activas con rol de prestatario. Detalle en `docs/specs/F34-F35-pantallas-de-prestamos.md` (B1–B5).
 */
export const SearchMembersQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/[\p{L}\p{N}]{2}/u, "Escribe al menos una palabra de 2 letras o números"),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  lendable: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type SearchMembersQuery = z.infer<typeof SearchMembersQuerySchema>;

/**
 * Listar cuentas con paginación — entrada de `GET /api/members?limit=&after=` (sin `q`). Orden por nombre y luego
 * por id; `after` es el id de la última cuenta de la página anterior. Detalle en `docs/specs/S1-endurecimiento-de-seguridad.md`.
 */
export const ListMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: IdSchema.optional(),
});
export type ListMembersQuery = z.infer<typeof ListMembersQuerySchema>;

/** Una página de cuentas. `next_after` es el valor para pedir la página siguiente, o `null` si no hay más. */
export const MemberPageSchema = z.object({
  members: z.array(MemberSchema),
  next_after: IdSchema.nullable(),
});
export type MemberPage = z.infer<typeof MemberPageSchema>;

/** F16 · Recuperar la contraseña — entrada. Solo se valida en el navegador: el envío lo hace el SDK de cliente de Firebase. */
export const ForgotPasswordInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>;
