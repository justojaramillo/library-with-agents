import { z } from "zod";
import { IdSchema, RoleSchema, SelectableRoleSchema } from "@/shared/schema";

/** F4 · Ingreso con correo y contraseña — entrada. */
export const LoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
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
  email: z.string().trim().toLowerCase().pipe(z.email()),
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
