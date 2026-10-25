import { LOAN_RULES } from "@/features/loans/schema";
import { DEFAULT_TIME_ZONE, formatDate } from "@/features/loans/ui/format";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { type MyTeacherRequest, TEACHER_REQUEST_RULES, type TeacherRequest } from "../schema";

const MS_PER_DAY = 86_400_000;

export const STAFF_TEXT = "El personal no pide el rol de docente.";
export const TEACHER_TEXT = "Ya tienes el rol de docente.";
export const VERIFY_HEADING = "Verifica tu correo";
export const VERIFY_TEXT =
  "Para solicitar el rol de docente primero debes verificar tu correo. Pulsa el enlace del mensaje que te enviamos o pide uno nuevo.";
export const PENDING_TEXT = "Tu solicitud está pendiente. El personal la revisará.";

/**
 * Qué muestra `/docente` (regla 17 de F11). Los textos ya vienen completos y con las fechas en español;
 * `detail` es una frase aparte (o `null`). `form` y `verify_email` además piden un control interactivo.
 */
export type TeacherRequestView =
  | { kind: "staff"; text: string; detail: null }
  | { kind: "teacher"; text: string; detail: string }
  | { kind: "verify_email"; text: string; detail: null }
  | { kind: "form"; text: null; detail: null }
  | { kind: "pending"; text: string; detail: string }
  | { kind: "rejected"; text: string; detail: null };

/** Solo para decidir qué mostrar; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Momento a partir del cual se puede volver a pedir tras un rechazo (decisión + 7 días). */
export function retryAfterOf(request: TeacherRequest): Date {
  const decided = new Date(request.decided_at ?? request.requested_at);
  return new Date(decided.getTime() + TEACHER_REQUEST_RULES.retryAfterDays * MS_PER_DAY);
}

/** Una solicitud rechazada ya se puede repetir cuando pasaron 7 días completos. */
function isRetryable(request: TeacherRequest, now: Date): boolean {
  return now.getTime() >= retryAfterOf(request).getTime();
}

function rejectedView(request: TeacherRequest, timeZone: string): TeacherRequestView {
  const decidedOn = formatDate(request.decided_at ?? request.requested_at, timeZone);
  const retryOn = formatDate(retryAfterOf(request).toISOString(), timeZone);
  const reason = request.reason ?? "";
  let motive = "";
  if (reason !== "") {
    motive = ` Motivo: ${reason}.`;
  }
  return {
    kind: "rejected",
    text: `Tu solicitud fue rechazada el ${decidedOn}.${motive} Podrás volver a pedirla el ${retryOn}.`,
    detail: null,
  };
}

function teacherView(): TeacherRequestView {
  const days = LOAN_RULES.loanDaysByRole.DOCENTE;
  const quota = LOAN_RULES.maxActiveLoansByRole.DOCENTE;
  return {
    kind: "teacher",
    text: TEACHER_TEXT,
    detail: `Tus préstamos duran ${days} días y puedes tener hasta ${quota} préstamos activos.`,
  };
}

/** Pendiente o rechazada sin reintento posible; `null` si no hay solicitud viva que mostrar. */
function viewOfLiveRequest(request: TeacherRequest | null, now: Date, timeZone: string): TeacherRequestView | null {
  if (request === null) {
    return null;
  }
  if (request.status === "PENDIENTE") {
    const sentOn = formatDate(request.requested_at, timeZone);
    return { kind: "pending", text: PENDING_TEXT, detail: `Enviada el ${sentOn}.` };
  }
  if (request.status === "RECHAZADA" && !isRetryable(request, now)) {
    return rejectedView(request, timeZone);
  }
  return null;
}

/**
 * Estado que muestra `/docente` para una persona (reglas 7 y 17 de F11). Función pura: el tiempo llega en `now`.
 * Orden: personal, docente, solicitud pendiente o rechazada sin reintento, correo sin verificar y, si nada
 * lo impide, el formulario. Una solicitud ya enviada se muestra aunque el correo haya dejado de estar verificado.
 */
export function describeTeacherRequestState(
  role: Role,
  mine: MyTeacherRequest,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): TeacherRequestView {
  if (isStaff(role)) {
    return { kind: "staff", text: STAFF_TEXT, detail: null };
  }
  if (role === "DOCENTE") {
    return teacherView();
  }
  const live = viewOfLiveRequest(mine.request, now, timeZone);
  if (live !== null) {
    return live;
  }
  if (!mine.email_verified) {
    return { kind: "verify_email", text: VERIFY_TEXT, detail: null };
  }
  return { kind: "form", text: null, detail: null };
}
