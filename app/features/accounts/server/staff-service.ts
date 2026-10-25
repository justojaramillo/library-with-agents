import { IdSchema, STAFF_ROLES, type Role, type SessionUser } from "@/shared/schema";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import {
  CreateStaffInputSchema,
  SetMemberActiveInputSchema,
  type CreateStaffInput,
  type Member,
  type ProvisionMemberInput,
} from "../schema";
import { toPublicMember } from "./member-service";
import type { MemberRepository } from "./repository";

/** Tope del listado de personal (regla 12). */
const STAFF_LIST_LIMIT = 200;

/** Cuerpo tal como llega: se valida aquí, tras comprobar al actor. Un `role` (u otro campo extra) se ignora. */
export type RawCreateStaffInput = Partial<CreateStaffInput> & { role?: string };

/** Resultado de la matriz de la regla 7. */
export type ActiveChangeDecision = { allowed: true } | { allowed: false; message: string };

export type StaffService = {
  /** F13 · Crea un bibliotecario (siempre activo). Solo ADMINISTRADOR (403 antes de validar). Correo repetido → 409. */
  create(actor: SessionUser, input: RawCreateStaffInput): Promise<Member>;
  /** F13 · Cuentas BIBLIOTECARIO y ADMINISTRADOR (hasta 200) por nombre y luego id. Solo ADMINISTRADOR. */
  list(actor: SessionUser): Promise<Member[]>;
  /**
   * F14 · Desactiva o reactiva. Orden: personal (403) → validación de `id` y `active` (400) → destino inexistente (404)
   * → matriz de la regla 7 (403). Idempotente. `active` llega sin validar del todo (p. ej. ausente): se valida aquí.
   */
  setActive(actor: SessionUser, id: string, active: boolean | undefined): Promise<Member>;
};

export type StaffServiceDeps = {
  members: Pick<MemberRepository, "findById" | "setActive" | "listByRoles">;
  /** `MemberAdminService.provision`: el servicio fija el rol, nunca el cliente. */
  provision: (input: ProvisionMemberInput) => Promise<Member>;
};

const STAFF_MESSAGE = "Solo para personal de la biblioteca";

function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

function assertStaff(actor: SessionUser): void {
  if (!isStaff(actor.role)) {
    throw new ForbiddenError(STAFF_MESSAGE);
  }
}

function assertAdministrator(actor: SessionUser, message: string): void {
  if (actor.role !== "ADMINISTRADOR") {
    throw new ForbiddenError(message);
  }
}

/**
 * Regla 7 · Quién puede cambiar a quién. Prioridad de los mensajes: destino ADMINISTRADOR, luego sí mismo, luego un
 * bibliotecario sobre otro personal. Función pura.
 */
export function canChangeActive(
  actorRole: Role,
  actorId: string,
  target: { id: string; role: Role },
): ActiveChangeDecision {
  if (target.role === "ADMINISTRADOR") {
    return { allowed: false, message: "El administrador no se puede desactivar." };
  }
  if (target.id === actorId) {
    return { allowed: false, message: "No puedes cambiar el estado de tu propia cuenta." };
  }
  if (actorRole === "BIBLIOTECARIO" && isStaff(target.role)) {
    return { allowed: false, message: "Un bibliotecario no puede cambiar el estado de otro personal." };
  }
  if (actorRole === "ADMINISTRADOR" || actorRole === "BIBLIOTECARIO") {
    return { allowed: true };
  }
  return { allowed: false, message: STAFF_MESSAGE };
}

export function createStaffService(deps: StaffServiceDeps): StaffService {
  return {
    async create(actor, input) {
      assertAdministrator(actor, "Solo el administrador crea bibliotecarios.");
      const valid = CreateStaffInputSchema.parse(input);
      return deps.provision({ ...valid, role: "BIBLIOTECARIO" });
    },
    async list(actor) {
      assertAdministrator(actor, "Solo el administrador ve el personal.");
      const records = await deps.members.listByRoles(["BIBLIOTECARIO", "ADMINISTRADOR"], STAFF_LIST_LIMIT);
      return records.map(toPublicMember);
    },
    async setActive(actor, id, active) {
      assertStaff(actor);
      const memberId = IdSchema.parse(id);
      const body = SetMemberActiveInputSchema.parse({ active });
      const target = await deps.members.findById(memberId);
      if (target === undefined) {
        throw new NotFoundError("La cuenta no existe.");
      }
      const decision = canChangeActive(actor.role, actor.member_id, target);
      if (!decision.allowed) {
        throw new ForbiddenError(decision.message);
      }
      if (target.active === body.active) {
        return toPublicMember(target);
      }
      const updated = await deps.members.setActive(memberId, body.active);
      if (updated === undefined) {
        throw new NotFoundError("La cuenta no existe.");
      }
      return toPublicMember(updated);
    },
  };
}
