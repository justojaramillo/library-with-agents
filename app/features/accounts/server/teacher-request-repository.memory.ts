import type { Id } from "@/shared/schema";
import { NotFoundError } from "@/shared/server/errors";
import { TeacherRequestSchema, type TeacherRequest } from "../schema";
import { unknownCursorError } from "./member-paging";
import { applyDecision, assertCanCreate } from "./teacher-request-rules";
import { compareRequestOrder } from "./teacher-request-paging";
import type { MemberRoleStore, TeacherRequestDecision, TeacherRequestRepository } from "./teacher-request-repository";

/**
 * Solicitudes en memoria para las pruebas. `create` y `decide` no tienen ningún `await` entre leer y escribir,
 * así que son atómicos igual que las transacciones de Firestore (el cambio de rol espera a la cuenta en memoria).
 */
class MemoryTeacherRequests implements TeacherRequestRepository {
  private readonly rows = new Map<Id, TeacherRequest>();

  constructor(private readonly members: MemberRoleStore) {}

  async get(memberId: Id) {
    const row = this.rows.get(memberId);
    return row && { ...row };
  }

  async create(request: TeacherRequest, retryAfter: Date) {
    const valid = TeacherRequestSchema.parse(request);
    assertCanCreate(this.rows.get(valid.member_id), retryAfter);
    this.rows.set(valid.member_id, { ...valid });
    return { ...valid };
  }

  async list(status: TeacherRequest["status"], limit: number, after?: Id) {
    let cursor: TeacherRequest | undefined;
    if (after !== undefined) {
      cursor = this.rows.get(after);
      if (cursor === undefined) {
        throw unknownCursorError();
      }
    }
    const sorted = [...this.rows.values()].filter((row) => row.status === status).sort(compareRequestOrder);
    const rest = sorted.filter((row) => cursor === undefined || compareRequestOrder(row, cursor) > 0);
    return { requests: rest.slice(0, limit).map((row) => ({ ...row })), hasMore: rest.length > limit };
  }

  async decide(memberId: Id, decision: TeacherRequestDecision, actorId: Id, now: Date) {
    if (!this.rows.has(memberId)) {
      throw new NotFoundError(`La solicitud de ${memberId} no existe`);
    }
    const account = await this.members.findById(memberId);
    // Se vuelve a leer la solicitud tras el `await`: si otra decisión se adelantó, `applyDecision` responde 409.
    const current = this.rows.get(memberId);
    if (current === undefined) {
      throw new NotFoundError(`La solicitud de ${memberId} no existe`);
    }
    const updated = applyDecision(current, account, decision, actorId, now);
    this.rows.set(memberId, updated);
    if (decision.kind === "approve") {
      await this.members.setRole(memberId, "DOCENTE");
    }
    return { ...updated };
  }
}

export function createMemoryTeacherRequestRepository(members: MemberRoleStore): TeacherRequestRepository {
  return new MemoryTeacherRequests(members);
}
