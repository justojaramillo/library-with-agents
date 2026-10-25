import { DEFAULT_TIME_ZONE, formatDate } from "@/features/loans/ui/format";
import type { TeacherRequestItem, TeacherRequestStatus } from "../schema";
import { ROLE_LABELS } from "./role-labels";
import { DecisionNotice, DecisionNoticeProvider, TeacherRequestActions } from "./teacher-request-actions";

/** Texto cuando el estado no tiene solicitudes (regla 3 de F37). */
export const EMPTY_REQUEST_TEXTS: Record<TeacherRequestStatus, string> = {
  PENDIENTE: "No hay solicitudes pendientes.",
  APROBADA: "No hay solicitudes aprobadas.",
  RECHAZADA: "No hay solicitudes rechazadas.",
};

export function emptyTextFor(status: TeacherRequestStatus): string {
  return EMPTY_REQUEST_TEXTS[status];
}

const DECISION_PREFIXES: Record<Exclude<TeacherRequestStatus, "PENDIENTE">, string> = {
  APROBADA: "Aprobada el",
  RECHAZADA: "Rechazada el",
};

/** Lo que se dice de una solicitud ya resuelta; `reason` ya trae el prefijo «Motivo: » o es `null`. */
export type RequestDecisionView = {
  /** «Aprobada el» / «Rechazada el». */
  prefix: string;
  /** Fecha en español, por ejemplo «30 de enero de 2026». */
  date: string;
  /** Fecha ISO para `<time datetime>`. */
  iso: string;
  /** Frase completa: «Aprobada el 30 de enero de 2026». */
  text: string;
  /** «Motivo: …» o `null` si no hay motivo. */
  reason: string | null;
};

function reasonText(reason: string | null): string | null {
  if (reason === null || reason === "") {
    return null;
  }
  return `Motivo: ${reason}`;
}

/**
 * Cómo se describe una solicitud resuelta (regla 4 de F37): «Aprobada el …» o «Rechazada el …» y, si lo hay, el motivo.
 * Las pendientes (o una resuelta sin fecha de decisión) devuelven `null`. Función pura.
 */
export function describeRequestStatus(
  item: Pick<TeacherRequestItem, "status" | "decided_at" | "reason">,
  timeZone: string = DEFAULT_TIME_ZONE,
): RequestDecisionView | null {
  if (item.status === "PENDIENTE" || item.decided_at === null) {
    return null;
  }
  const prefix = DECISION_PREFIXES[item.status];
  const date = formatDate(item.decided_at, timeZone);
  return { prefix, date, iso: item.decided_at, text: `${prefix} ${date}`, reason: reasonText(item.reason) };
}

/** Texto del estado del correo (regla 4 de F37). */
export function describeEmailState(emailVerified: boolean): string {
  if (emailVerified) {
    return "Correo verificado";
  }
  return "Correo sin verificar";
}

const ICON_CLASS = "mt-1 size-4 shrink-0";

/** Estado del correo: icono y texto, nunca solo color. */
function EmailState({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <p className="flex items-start gap-2 font-medium text-success">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={ICON_CLASS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8.5l3.5 3.5L13 4.5" />
        </svg>
        {describeEmailState(true)}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 font-medium text-warning">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={ICON_CLASS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.5" />
      </svg>
      {describeEmailState(false)}
    </p>
  );
}

function Decision({ view }: { view: RequestDecisionView }) {
  return (
    <>
      <p>
        {view.prefix} <time dateTime={view.iso}>{view.date}</time>
      </p>
      <Reason reason={view.reason} />
    </>
  );
}

function Reason({ reason }: { reason: string | null }) {
  if (reason === null) {
    return null;
  }
  return <p className="whitespace-pre-line break-words">{reason}</p>;
}

/** Solo las pendientes tienen acciones; el resto es de solo lectura (regla 5). */
function Footer({ item }: { item: TeacherRequestItem }) {
  if (item.status === "PENDIENTE") {
    return (
      <TeacherRequestActions
        memberId={item.member_id}
        memberName={item.member_name}
        emailVerified={item.email_verified}
      />
    );
  }
  const view = describeRequestStatus(item);
  if (view === null) {
    return null;
  }
  return <Decision view={view} />;
}

function RequestItem({ item }: { item: TeacherRequestItem }) {
  return (
    <li className="min-w-0">
      <article className="grid h-full content-start gap-3 rounded border border-line bg-surface p-4">
        <h2 className="text-lg font-semibold break-words">{item.member_name}</h2>
        <dl className="grid gap-1 text-ink-muted">
          <div>
            <dt className="inline text-ink">Correo: </dt>
            <dd className="inline break-words">{item.member_email}</dd>
          </div>
          <div>
            <dt className="inline text-ink">Rol: </dt>
            <dd className="inline">{ROLE_LABELS[item.member_role]}</dd>
          </div>
        </dl>
        <p className="text-ink-muted">
          Enviada el <time dateTime={item.requested_at}>{formatDate(item.requested_at, DEFAULT_TIME_ZONE)}</time>
        </p>
        <EmailState verified={item.email_verified} />
        <h3 className="font-medium">Nota de la persona</h3>
        <p className="whitespace-pre-line break-words">{item.note}</p>
        <Footer item={item} />
      </article>
    </li>
  );
}

function RequestBody({ requests, status }: { requests: TeacherRequestItem[]; status: TeacherRequestStatus }) {
  if (requests.length === 0) {
    return <p className="text-ink-muted">{emptyTextFor(status)}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {requests.map((item) => (
        <RequestItem key={item.member_id} item={item} />
      ))}
    </ul>
  );
}

/**
 * F37 · Lista de solicitudes (presentacional): una tarjeta por solicitud, 1 columna hasta 768 px y 2 desde 1024 px.
 * Todo lo que escribió la persona se muestra como texto escapado, con los saltos de línea respetados.
 */
export function TeacherRequestList({
  requests,
  status,
}: {
  requests: TeacherRequestItem[];
  status: TeacherRequestStatus;
}) {
  return (
    <DecisionNoticeProvider>
      <DecisionNotice />
      <RequestBody requests={requests} status={status} />
    </DecisionNoticeProvider>
  );
}
