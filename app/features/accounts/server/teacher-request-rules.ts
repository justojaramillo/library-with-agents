import { ConflictError } from "@/shared/server/errors";
import type { Role } from "@/shared/schema";
import { TEACHER_REQUEST_RULES, type TeacherRequest } from "../schema";
import type { TeacherRequestDecision } from "./teacher-request-repository";

const DAY_MS = 86_400_000;

/** Fecha legible en español (en UTC, para que no dependa de la zona del servidor). */
function formatDate(date: Date): string {
  return date.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Instante de corte para la regla 7.5: ahora menos 7 días. */
export function retryCutoff(now: Date): Date {
  return new Date(now.getTime() - TEACHER_REQUEST_RULES.retryAfterDays * DAY_MS);
}

/** Reglas 7.4 y 7.5 · Lanza `ConflictError` si la solicitud anterior impide crear una nueva. */
export function assertCanCreate(previous: TeacherRequest | undefined, retryAfter: Date): void {
  if (previous === undefined) {
    return;
  }
  if (previous.status === "PENDIENTE") {
    throw new ConflictError("Ya tienes una solicitud pendiente.");
  }
  if (previous.status === "RECHAZADA" && previous.decided_at !== null) {
    const decidedAt = new Date(previous.decided_at);
    if (decidedAt.getTime() > retryAfter.getTime()) {
      const again = new Date(decidedAt.getTime() + TEACHER_REQUEST_RULES.retryAfterDays * DAY_MS);
      throw new ConflictError(`Tu solicitud anterior fue rechazada; podrás volver a pedirla el ${formatDate(again)}.`);
    }
  }
}

/** Cuenta tal como la ve la transacción de `decide`. */
export type AccountState = { role: Role; active: boolean } | undefined;

/**
 * Regla 13 · Valida la decisión contra la solicitud y la cuenta y devuelve la solicitud actualizada.
 * Lanza `ConflictError` según el orden de la spec. Quien la llama aplica el cambio de rol si es una aprobación.
 */
export function applyDecision(
  request: TeacherRequest,
  account: AccountState,
  decision: TeacherRequestDecision,
  actorId: string,
  now: Date,
): TeacherRequest {
  if (request.status !== "PENDIENTE") {
    throw new ConflictError("La solicitud ya fue resuelta.");
  }
  const decided = { decided_at: now.toISOString(), decided_by: actorId };
  if (decision.kind === "reject") {
    return { ...request, ...decided, status: "RECHAZADA", reason: decision.reason };
  }
  const canReceive =
    account !== undefined && account.active && (account.role === "EXTERNO" || account.role === "ESTUDIANTE");
  if (!canReceive) {
    throw new ConflictError("La cuenta ya no puede recibir el rol de docente.");
  }
  if (!decision.emailVerified) {
    throw new ConflictError("El correo de la persona ya no está verificado.");
  }
  return { ...request, ...decided, status: "APROBADA", reason: null };
}
