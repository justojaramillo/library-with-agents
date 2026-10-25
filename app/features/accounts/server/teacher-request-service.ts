import { type Id, type SessionUser, STAFF_ROLES } from "@/shared/schema";
import { ConflictError, ForbiddenError } from "@/shared/server/errors";
import {
  CreateTeacherRequestInputSchema,
  RejectTeacherRequestInputSchema,
  type ListTeacherRequestsQuery,
  type MyTeacherRequest,
  type TeacherRequest,
  type TeacherRequestItem,
  type TeacherRequestPage,
} from "../schema";
import type { IdentityProvider } from "./identity";
import type { MemberRecord, MemberRepository } from "./repository";
import { assertCanCreate, retryCutoff } from "./teacher-request-rules";
import type { TeacherRequestRepository } from "./teacher-request-repository";

export type TeacherRequestServiceDeps = {
  requests: TeacherRequestRepository;
  members: Pick<MemberRepository, "findByIds">;
  identity: Pick<IdentityProvider, "isEmailVerified">;
};

export type TeacherRequestService = {
  /**
   * F11 · Crea la solicitud de la sesión. Orden de la regla 7: rol (DOCENTE → 409, personal → 403), correo
   * verificado (403), solicitud pendiente (409), rechazo reciente (409) y, al final, validación de `input` (400).
   * `input` llega sin validar del todo: se valida aquí, en el último paso.
   */
  request(actor: SessionUser, input: { note?: string }, now: Date): Promise<TeacherRequest>;
  /** F11 · La solicitud propia (o `null`; el personal siempre `null`) y si el correo está verificado. */
  getMine(actor: SessionUser): Promise<MyTeacherRequest>;
  /** F12 · Listado paginado para el personal (`ForbiddenError` si el actor no lo es). */
  list(actor: SessionUser, query: ListTeacherRequestsQuery): Promise<TeacherRequestPage>;
  /** F12 · Aprueba (pasa la cuenta a DOCENTE). Solo personal. */
  approve(actor: SessionUser, id: Id, now: Date): Promise<TeacherRequest>;
  /** F12 · Rechaza con motivo opcional. Solo personal. `input` se valida aquí. */
  reject(actor: SessionUser, id: Id, input: { reason?: string }, now: Date): Promise<TeacherRequest>;
};

function isStaff(actor: SessionUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

function assertStaff(actor: SessionUser): void {
  if (!isStaff(actor)) {
    throw new ForbiddenError("Solo para personal de la biblioteca");
  }
}

/** Regla 7.2 · Solo EXTERNO y ESTUDIANTE pueden pedir el rol. */
function assertBorrowerCanAsk(actor: SessionUser): void {
  if (actor.role === "DOCENTE") {
    throw new ConflictError("Ya eres docente.");
  }
  if (isStaff(actor)) {
    throw new ForbiddenError("El personal no pide el rol de docente.");
  }
}

/** Arma los elementos del listado con la cuenta y la verificación leídas ahora; las cuentas inexistentes se omiten. */
async function toItems(deps: TeacherRequestServiceDeps, requests: TeacherRequest[]): Promise<TeacherRequestItem[]> {
  const records = await deps.members.findByIds([...new Set(requests.map((request) => request.member_id))]);
  const byId = new Map<Id, MemberRecord>(records.map((record) => [record.id, record]));
  const items = await Promise.all(
    requests.map(async (request): Promise<TeacherRequestItem[]> => {
      const member = byId.get(request.member_id);
      if (member === undefined) {
        return [];
      }
      const emailVerified = await deps.identity.isEmailVerified(member.id);
      return [
        {
          ...request,
          member_name: member.name,
          member_email: member.email,
          member_role: member.role,
          email_verified: emailVerified,
        },
      ];
    }),
  );
  return items.flat();
}

/** F11–F12 · Solicitud del rol de docente. Las dependencias llegan por parámetro; el tiempo se inyecta. */
export function createTeacherRequestService(deps: TeacherRequestServiceDeps): TeacherRequestService {
  return {
    async request(actor, input, now) {
      assertBorrowerCanAsk(actor);
      if (!(await deps.identity.isEmailVerified(actor.member_id))) {
        throw new ForbiddenError("Verifica tu correo para solicitar el rol de docente.");
      }
      const retryAfter = retryCutoff(now);
      assertCanCreate(await deps.requests.get(actor.member_id), retryAfter);
      const { note } = CreateTeacherRequestInputSchema.parse(input);
      return deps.requests.create(
        {
          member_id: actor.member_id,
          note,
          status: "PENDIENTE",
          requested_at: now.toISOString(),
          decided_at: null,
          decided_by: null,
          reason: null,
        },
        retryAfter,
      );
    },
    async getMine(actor) {
      const emailVerified = await deps.identity.isEmailVerified(actor.member_id);
      if (isStaff(actor)) {
        return { request: null, email_verified: emailVerified };
      }
      const request = await deps.requests.get(actor.member_id);
      return { request: request ?? null, email_verified: emailVerified };
    },
    async list(actor, query) {
      assertStaff(actor);
      const page = await deps.requests.list(query.status, query.limit, query.after);
      const last = page.requests.at(-1);
      const items = await toItems(deps, page.requests);
      if (!page.hasMore || last === undefined) {
        return { requests: items, next_after: null };
      }
      return { requests: items, next_after: last.member_id };
    },
    async approve(actor, id, now) {
      assertStaff(actor);
      const emailVerified = await deps.identity.isEmailVerified(id);
      return deps.requests.decide(id, { kind: "approve", emailVerified }, actor.member_id, now);
    },
    async reject(actor, id, input, now) {
      assertStaff(actor);
      const { reason } = RejectTeacherRequestInputSchema.parse(input);
      return deps.requests.decide(id, { kind: "reject", reason: reason ?? null }, actor.member_id, now);
    },
  };
}
