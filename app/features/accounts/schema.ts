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

/** F11–F12 · Reglas de la solicitud del rol de docente (`docs/specs/F11-F12-solicitud-de-docente.md`). */
export const TEACHER_REQUEST_RULES = {
  noteMin: 10,
  noteMax: 500,
  reasonMax: 300,
  retryAfterDays: 7,
} as const;

export const TeacherRequestStatusSchema = z.enum(["PENDIENTE", "APROBADA", "RECHAZADA"]);
export type TeacherRequestStatus = z.infer<typeof TeacherRequestStatusSchema>;

/** F11 · Solicitar el rol de docente — entrada. La identidad sale de la sesión; cualquier otro campo se ignora. */
export const CreateTeacherRequestInputSchema = z.object({
  note: z.string().trim().min(TEACHER_REQUEST_RULES.noteMin).max(TEACHER_REQUEST_RULES.noteMax),
});
export type CreateTeacherRequestInput = z.infer<typeof CreateTeacherRequestInputSchema>;

function emptyToUndefined(value: string): string | undefined {
  if (value === "") {
    return undefined;
  }
  return value;
}

/** F12 · Rechazar una solicitud — entrada. `reason` es opcional; `""` (tras recortar) equivale a ausente. */
export const RejectTeacherRequestInputSchema = z.object({
  reason: z.string().trim().max(TEACHER_REQUEST_RULES.reasonMax).transform(emptyToUndefined).optional(),
});
export type RejectTeacherRequestInput = z.infer<typeof RejectTeacherRequestInputSchema>;

/** Una solicitud por persona (el id del documento es `member_id`). Las fechas son ISO; `decided_*` y `reason` son `null` mientras esté pendiente. */
export const TeacherRequestSchema = z.object({
  member_id: IdSchema,
  note: z.string(),
  status: TeacherRequestStatusSchema,
  requested_at: z.string(),
  decided_at: z.string().nullable(),
  decided_by: IdSchema.nullable(),
  reason: z.string().nullable(),
});
export type TeacherRequest = z.infer<typeof TeacherRequestSchema>;

/** F12 · Elemento del listado del personal: la solicitud más datos de la cuenta leídos al listar. */
export const TeacherRequestItemSchema = TeacherRequestSchema.extend({
  member_name: z.string(),
  member_email: z.string(),
  member_role: RoleSchema,
  email_verified: z.boolean(),
});
export type TeacherRequestItem = z.infer<typeof TeacherRequestItemSchema>;

/** F12 · `GET /api/teacher-requests?status=&limit=&after=` — orden por `requested_at` y luego id; `after` es el `member_id` de la última. */
export const ListTeacherRequestsQuerySchema = z.object({
  status: TeacherRequestStatusSchema.default("PENDIENTE"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: IdSchema.optional(),
});
export type ListTeacherRequestsQuery = z.infer<typeof ListTeacherRequestsQuerySchema>;

export const TeacherRequestPageSchema = z.object({
  requests: z.array(TeacherRequestItemSchema),
  next_after: IdSchema.nullable(),
});
export type TeacherRequestPage = z.infer<typeof TeacherRequestPageSchema>;

/** F11 · `GET /api/me/teacher-request` — la solicitud propia (o `null`) y si el correo está verificado. */
export const MyTeacherRequestSchema = z.object({
  request: TeacherRequestSchema.nullable(),
  email_verified: z.boolean(),
});
export type MyTeacherRequest = z.infer<typeof MyTeacherRequestSchema>;
