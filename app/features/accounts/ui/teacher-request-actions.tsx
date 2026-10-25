"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { TEACHER_REQUEST_RULES } from "../schema";
import { readRequestErrorMessage } from "./request-error";

export const NETWORK_MESSAGE = "No se pudo completar la acción";
export const SESSION_ENDED_MESSAGE = "Tu sesión terminó. Vuelve a ingresar.";
export const UNVERIFIED_HINT = "No se puede aprobar hasta que la persona verifique su correo.";

const BUTTON_CLASS = "min-h-11 min-w-11 rounded px-4 font-medium";
const PRIMARY_CLASS = `${BUTTON_CLASS} bg-primary text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border`;
const SECONDARY_CLASS = `${BUTTON_CLASS} border border-control-border bg-surface text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-muted`;

export type DecisionAction = "approve" | "reject";
type DecisionStep = "idle" | "approving" | "rejecting";
type CardError = { text: string; login: boolean };
type Notice = { kind: "done" | "error"; text: string };

/** Error de una decisión: el estado HTTP y el mensaje que mandó el servidor (o el de respaldo). */
export class DecisionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DecisionError";
    this.status = status;
  }
}

function isSessionStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Mensaje para un error de aprobar o rechazar (regla 11 de F37). 401 y 403: sesión terminada; otros errores del
 * servidor: su propio mensaje; cualquier otra cosa (fallo de red, cuerpo ilegible): «No se pudo completar la acción».
 * El `catch` lo pasa tal cual, sin anotarle tipo.
 */
export function messageForDecisionError<T>(error: T): string {
  if (!(error instanceof DecisionError)) {
    return NETWORK_MESSAGE;
  }
  if (isSessionStatus(error.status)) {
    return SESSION_ENDED_MESSAGE;
  }
  return error.message;
}

/** `true` si el error significa que hay que volver a ingresar (401 o 403). */
export function isSessionDecisionError<T>(error: T): boolean {
  return error instanceof DecisionError && isSessionStatus(error.status);
}

/** `true` si el estado cambió en el servidor (409): además del mensaje se recarga la lista. */
export function isConflictDecisionError<T>(error: T): boolean {
  return error instanceof DecisionError && error.status === 409;
}

/** Aviso de éxito (reglas 8 y 9 de F37). */
export function successMessage(action: DecisionAction, name: string): string {
  if (action === "approve") {
    return `Aprobada: ${name} ahora es docente.`;
  }
  return `Rechazada la solicitud de ${name}.`;
}

/** Largo del motivo como lo cuenta el contrato: recortado y con `.length`. */
export function reasonLength(reason: string): number {
  return reason.trim().length;
}

/** Cuerpo del rechazo: `{ reason }` solo si el motivo recortado no está vacío; si no, ningún cuerpo. */
export function rejectBody(reason: string): { reason: string } | null {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return null;
  }
  return { reason: trimmed };
}

/** `POST /api/teacher-requests/:id/approve|reject`. Si falla lanza `DecisionError`; un fallo de red sube tal cual. */
async function postDecision(memberId: string, action: DecisionAction, reason: string): Promise<void> {
  const url = `/api/teacher-requests/${encodeURIComponent(memberId)}/${action}`;
  const body = rejectBody(reason);
  let res: Response;
  if (action === "reject" && body !== null) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } else {
    res = await fetch(url, { method: "POST" });
  }
  if (!res.ok) {
    throw new DecisionError(res.status, await readRequestErrorMessage(res, NETWORK_MESSAGE));
  }
}

type NoticeValue = { notice: Notice | null; setNotice: (notice: Notice | null) => void; noticeId: string };

/** Sin proveedor, publicar un aviso no hace nada (p. ej. al probar las acciones solas). */
const NoticeContext = createContext<NoticeValue>({ notice: null, setNotice: () => undefined, noticeId: "" });

/**
 * Guarda el último aviso fuera de las tarjetas: al decidir, la tarjeta desaparece de la lista
 * y su mensaje desaparecería con ella.
 */
export function DecisionNoticeProvider({ children }: { children: ReactNode }) {
  const noticeId = useId();
  const [notice, setNotice] = useState<Notice | null>(null);
  return <NoticeContext.Provider value={{ notice, setNotice, noticeId }}>{children}</NoticeContext.Provider>;
}

/** Resultado de la última decisión: éxito en `role="status"`, conflicto en `role="alert"`. */
export function DecisionNotice() {
  const { notice, noticeId } = useContext(NoticeContext);
  if (notice === null) {
    return null;
  }
  if (notice.kind === "error") {
    return (
      <p id={noticeId} role="alert" className="font-medium text-danger">
        {notice.text}
      </p>
    );
  }
  return (
    <p id={noticeId} role="status" className="font-medium text-success">
      {notice.text}
    </p>
  );
}

function useDecision(memberId: string, memberName: string) {
  const router = useRouter();
  const { setNotice } = useContext(NoticeContext);
  const busy = useRef(false);
  const [step, setStep] = useState<DecisionStep>("idle");
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<CardError | null>(null);
  const [conflict, setConflict] = useState(false);

  function fail<T>(caught: T) {
    busy.current = false;
    setSending(false);
    const text = messageForDecisionError(caught);
    if (isConflictDecisionError(caught)) {
      // La solicitud cambió en el servidor: el aviso vive fuera de la tarjeta, que puede desaparecer al recargar.
      setConflict(true);
      setNotice({ kind: "error", text });
      router.refresh();
      return;
    }
    setConflict(false);
    setError({ text, login: isSessionDecisionError(caught) });
  }

  async function submit(action: DecisionAction) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    setConflict(false);
    setNotice(null);
    try {
      await postDecision(memberId, action, reason);
    } catch (caught) {
      fail(caught);
      return;
    }
    // Se queda deshabilitado: la tarjeta desaparece al recargar la lista.
    setNotice({ kind: "done", text: successMessage(action, memberName) });
    router.refresh();
  }

  function open(next: DecisionStep) {
    setError(null);
    setConflict(false);
    setStep(next);
  }

  return { step, sending, reason, setReason, error, conflict, submit, open };
}

type ControlsProps = {
  name: string;
  emailVerified: boolean;
  sending: boolean;
  onOpen: (step: DecisionStep) => void;
  hintId: string;
  messageId: string | undefined;
};

function IdleControls({ name, emailVerified, sending, onOpen, hintId, messageId }: ControlsProps) {
  return (
    <>
      <button
        type="button"
        disabled={sending || !emailVerified}
        aria-label={`Aprobar a ${name}`}
        aria-describedby={describedBy([hintIdFor(emailVerified, hintId), messageId])}
        onClick={() => onOpen("approving")}
        className={PRIMARY_CLASS}
      >
        Aprobar
      </button>
      <button
        type="button"
        disabled={sending}
        aria-label={`Rechazar a ${name}`}
        aria-describedby={describedBy([messageId])}
        onClick={() => onOpen("rejecting")}
        className={SECONDARY_CLASS}
      >
        Rechazar
      </button>
    </>
  );
}

/** El aviso de «correo sin verificar» solo enlaza al botón cuando está visible. */
function hintIdFor(emailVerified: boolean, hintId: string): string | undefined {
  if (emailVerified) {
    return undefined;
  }
  return hintId;
}

/** Une los ids que existen; `undefined` si no hay ninguno. */
function describedBy(ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined && id !== "");
  if (present.length === 0) {
    return undefined;
  }
  return present.join(" ");
}

function ApproveConfirm(props: {
  name: string;
  sending: boolean;
  messageId: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <button
        type="button"
        disabled={props.sending}
        aria-label={`Confirmar aprobación de ${props.name}`}
        aria-describedby={props.messageId}
        onClick={props.onConfirm}
        className={PRIMARY_CLASS}
      >
        Confirmar aprobación
      </button>
      <button type="button" disabled={props.sending} onClick={props.onCancel} className={SECONDARY_CLASS}>
        Cancelar
      </button>
    </>
  );
}

type RejectFormProps = {
  name: string;
  reason: string;
  sending: boolean;
  messageId: string | undefined;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function RejectForm(props: RejectFormProps) {
  const fieldId = useId();
  const counterId = useId();
  const length = reasonLength(props.reason);
  return (
    <form
      noValidate
      aria-label={`Rechazar la solicitud de ${props.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        props.onConfirm();
      }}
      className="grid w-full gap-2"
    >
      <label htmlFor={fieldId} className="font-medium">
        Motivo (opcional)
      </label>
      <textarea
        id={fieldId}
        name="reason"
        rows={3}
        value={props.reason}
        disabled={props.sending}
        onChange={(e) => props.onReason(e.target.value)}
        aria-describedby={describedBy([counterId, props.messageId])}
        aria-invalid={props.messageId !== undefined}
        className="min-h-11 w-full rounded border border-control-border bg-surface px-3 py-2 text-ink"
      />
      <p id={counterId} className="text-sm text-ink-muted">
        {length} de {TEACHER_REQUEST_RULES.reasonMax} caracteres
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={props.sending} className={PRIMARY_CLASS}>
          Confirmar rechazo
        </button>
        <button type="button" disabled={props.sending} onClick={props.onCancel} className={SECONDARY_CLASS}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CardError({ error, id }: { error: CardError | null; id: string }) {
  if (error === null) {
    return null;
  }
  return (
    <p id={id} role="alert" className="font-medium text-danger">
      {error.text} <LoginLink visible={error.login} />
    </p>
  );
}

function LoginLink({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primary underline">
      Ingresar
    </Link>
  );
}

function UnverifiedHint({ id, visible }: { id: string; visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <p id={id} className="text-ink-muted">
      {UNVERIFIED_HINT}
    </p>
  );
}

type ActionsProps = { memberId: string; memberName: string; emailVerified: boolean };

/**
 * F37 · Acciones de una solicitud pendiente (reglas 6 a 11). Aprobar va en dos pasos; rechazar pide un motivo
 * opcional. Solo oculta o deshabilita: el servidor vuelve a comprobar rol, estado y verificación del correo.
 */
export function TeacherRequestActions({ memberId, memberName, emailVerified }: ActionsProps) {
  const hintId = useId();
  const errorId = useId();
  const { noticeId } = useContext(NoticeContext);
  const d = useDecision(memberId, memberName);
  let messageId: string | undefined;
  if (d.error !== null) {
    messageId = errorId;
  } else if (d.conflict) {
    messageId = noticeId;
  }
  return (
    <section aria-label={`Acciones para ${memberName}`} className="grid gap-3">
      <UnverifiedHint id={hintId} visible={!emailVerified} />
      <Steps d={d} name={memberName} emailVerified={emailVerified} hintId={hintId} messageId={messageId} />
      <CardError error={d.error} id={errorId} />
    </section>
  );
}

function Steps(props: {
  d: ReturnType<typeof useDecision>;
  name: string;
  emailVerified: boolean;
  hintId: string;
  messageId: string | undefined;
}) {
  const { d } = props;
  if (d.step === "rejecting") {
    return (
      <RejectForm
        name={props.name}
        reason={d.reason}
        sending={d.sending}
        messageId={props.messageId}
        onReason={d.setReason}
        onConfirm={() => void d.submit("reject")}
        onCancel={() => d.open("idle")}
      />
    );
  }
  if (d.step === "approving") {
    return (
      <div className="flex flex-wrap gap-2">
        <ApproveConfirm
          name={props.name}
          sending={d.sending}
          messageId={props.messageId}
          onConfirm={() => void d.submit("approve")}
          onCancel={() => d.open("idle")}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <IdleControls
        name={props.name}
        emailVerified={props.emailVerified}
        sending={d.sending}
        onOpen={d.open}
        hintId={props.hintId}
        messageId={props.messageId}
      />
    </div>
  );
}
