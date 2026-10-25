"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { ReturnResultSchema } from "../schema";
import { readErrorMessage } from "./api-client";
import { formatCop } from "./format";

const RETURN_ERROR = "No se pudo devolver";
const BUTTON_CLASS = "min-h-11 min-w-11 rounded px-4 font-medium";

type ReturnMessage = { kind: "done"; text: string } | { kind: "error"; text: string };
type ReturnStep = "idle" | "confirming" | "sending";

type NoticeValue = { message: ReturnMessage | null; setMessage: (message: ReturnMessage | null) => void };

/** Sin proveedor, publicar un aviso no hace nada (p. ej. al probar el botón solo). */
const NoticeContext = createContext<NoticeValue>({ message: null, setMessage: () => undefined });

/**
 * Guarda el aviso de la última devolución fuera de las tarjetas: al devolver, la tarjeta desaparece
 * de la lista y su mensaje desaparecería con ella.
 */
export function ReturnNoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ReturnMessage | null>(null);
  return <NoticeContext.Provider value={{ message, setMessage }}>{children}</NoticeContext.Provider>;
}

/** Resultado de la última devolución: éxito en `role="status"`, error en `role="alert"`. */
export function ReturnNotice() {
  const { message } = useContext(NoticeContext);
  if (message === null) {
    return null;
  }
  if (message.kind === "error") {
    return (
      <p role="alert" className="font-medium text-danger">
        {message.text}
      </p>
    );
  }
  return (
    <p role="status" className="font-medium text-success">
      {message.text}
    </p>
  );
}

type ReturnOutcome = { ok: true; text: string } | { ok: false; text: string };

function doneText(title: string, fine: number): string {
  if (fine === 0) {
    return `Devuelto «${title}». Sin multa.`;
  }
  return `Devuelto «${title}». Multa: ${formatCop(fine)} (se informa; no se guarda).`;
}

/** Envía `POST /api/loans/:id/return` sin cuerpo y valida el resultado con el contrato. */
async function postReturn(loanId: string, title: string): Promise<ReturnOutcome> {
  try {
    const res = await fetch(`/api/loans/${encodeURIComponent(loanId)}/return`, { method: "POST" });
    if (!res.ok) {
      return { ok: false, text: await readErrorMessage(res, RETURN_ERROR) };
    }
    const result = ReturnResultSchema.parse(await res.json());
    return { ok: true, text: doneText(title, result.fine_cop) };
  } catch {
    return { ok: false, text: RETURN_ERROR };
  }
}

/** F34 · Devolver en dos pasos: «Devolver» → «Confirmar devolución» / «Cancelar». Una sola petición. */
export function ReturnButton(props: { loanId: string; bookTitle: string }) {
  const router = useRouter();
  const { setMessage } = useContext(NoticeContext);
  const [step, setStep] = useState<ReturnStep>("idle");
  const busy = useRef(false);

  async function confirm() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setStep("sending");
    setMessage(null);
    const outcome = await postReturn(props.loanId, props.bookTitle);
    if (!outcome.ok) {
      busy.current = false;
      setStep("idle");
      setMessage({ kind: "error", text: outcome.text });
      return;
    }
    // Se queda deshabilitado: la tarjeta desaparece al recargar la lista.
    setMessage({ kind: "done", text: outcome.text });
    router.refresh();
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        aria-label={`Devolver «${props.bookTitle}»`}
        onClick={() => setStep("confirming")}
        className={`${BUTTON_CLASS} border border-control-border bg-surface text-ink hover:bg-surface-alt`}
      >
        Devolver
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={step === "sending"}
        aria-label={`Confirmar devolución de «${props.bookTitle}»`}
        onClick={() => void confirm()}
        className={`${BUTTON_CLASS} bg-primary text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border`}
      >
        Confirmar devolución
      </button>
      <button
        type="button"
        disabled={step === "sending"}
        onClick={() => setStep("idle")}
        className={`${BUTTON_CLASS} border border-control-border bg-surface text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-muted`}
      >
        Cancelar
      </button>
    </div>
  );
}
