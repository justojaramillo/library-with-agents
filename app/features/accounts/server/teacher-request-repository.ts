import type { Id, Role } from "@/shared/schema";
import type { TeacherRequest, TeacherRequestStatus } from "../schema";

/** Lo que se decide sobre una solicitud pendiente. `emailVerified` lo lee el servicio de Firebase Authentication justo antes. */
export type TeacherRequestDecision =
  | { kind: "approve"; emailVerified: boolean }
  | { kind: "reject"; reason: string | null };

/** Una página de solicitudes: `hasMore` es `true` si existe al menos una más después de la última. */
export type TeacherRequestRecordPage = { requests: TeacherRequest[]; hasMore: boolean };

/**
 * Puerto de las solicitudes de docente (F11–F12). Una solicitud por persona: el id es el `member_id`.
 * `create` y `decide` son atómicos (transacciones en Firestore).
 */
export interface TeacherRequestRepository {
  /** La solicitud de esa persona, o `undefined`. */
  get(memberId: Id): Promise<TeacherRequest | undefined>;
  /**
   * Regla 8 · Guarda `request` (estado `PENDIENTE`) como la solicitud de la persona, reemplazando una anterior.
   * `retryAfter` es el instante de corte (ahora menos 7 días): una solicitud anterior `RECHAZADA` con `decided_at`
   * posterior a ese corte (estricto) bloquea. `ConflictError` si la anterior es `PENDIENTE` («Ya tienes una solicitud
   * pendiente.») o si el rechazo aún no es reintentable («Tu solicitud anterior fue rechazada; podrás volver a pedirla el {fecha}.»).
   */
  create(request: TeacherRequest, retryAfter: Date): Promise<TeacherRequest>;
  /**
   * Orden por `requested_at` ascendente y luego por id, solo del `status` pedido, a partir de la que sigue a `after`
   * (`member_id` de la última de la página anterior; no existe → `ZodError`, 400). Lee `limit + 1` para calcular `hasMore`.
   */
  list(status: TeacherRequestStatus, limit: number, after?: Id): Promise<TeacherRequestRecordPage>;
  /**
   * Regla 13 · Transacción que lee la solicitud y la cuenta y decide. `NotFoundError` si no hay solicitud;
   * `ConflictError` si no está `PENDIENTE` («La solicitud ya fue resuelta.»); al aprobar, `ConflictError` si la cuenta no
   * existe, está inactiva o no es EXTERNO/ESTUDIANTE («La cuenta ya no puede recibir el rol de docente.») o si
   * `emailVerified` es `false` («El correo de la persona ya no está verificado.»). Al aprobar cambia el rol de la
   * cuenta a `DOCENTE` en la misma transacción. Devuelve la solicitud actualizada.
   */
  decide(memberId: Id, decision: TeacherRequestDecision, actorId: Id, now: Date): Promise<TeacherRequest>;
}

/** Lo que el repositorio en memoria necesita de las cuentas (lo cumple `createMemoryMemberRepository()`). */
export interface MemberRoleStore {
  findById(id: Id): Promise<{ id: Id; role: Role; active: boolean } | undefined>;
  setRole(id: Id, role: Role): Promise<void>;
}
