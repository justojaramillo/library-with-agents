"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
// Primero: fija Zod sin compilación antes de que `../schema` cree sus esquemas (CSP).
import "@/shared/ui/client-setup";
import { type CreateTeacherRequestInput, CreateTeacherRequestInputSchema, TEACHER_REQUEST_RULES } from "../schema";
import { readErrorMessage } from "./auth-client";

const DEFAULT_ERROR = "No se pudo enviar la solicitud";
const RATE_LIMIT_ERROR = "Demasiadas solicitudes. Inténtalo más tarde.";
const INVALID_NOTE_ERROR = `Escribe entre ${TEACHER_REQUEST_RULES.noteMin} y ${TEACHER_REQUEST_RULES.noteMax} caracteres.`;
const SENT_NOTICE = "Solicitud enviada.";

/** Resultado del envío: texto de error o `null` si salió bien. */
async function postRequest(input: CreateTeacherRequestInput): Promise<string | null> {
  try {
    const res = await fetch("/api/me/teacher-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      return null;
    }
    if (res.status === 429) {
      return RATE_LIMIT_ERROR;
    }
    return await readErrorMessage(res, DEFAULT_ERROR);
  } catch {
    return DEFAULT_ERROR;
  }
}

/** Largo de la nota como lo cuenta el contrato: recortada y por caracteres. */
function noteLength(note: string): number {
  return Array.from(note.trim()).length;
}

function Feedback({ error, sent, id }: { error: string | null; sent: boolean; id: string }) {
  if (error !== null) {
    return (
      <p id={id} role="alert" className="font-medium text-danger">
        {error}
      </p>
    );
  }
  if (sent) {
    return (
      <p id={id} role="status" className="font-medium text-success">
        {SENT_NOTICE}
      </p>
    );
  }
  return null;
}

/** Enlaza el campo con el contador y, si existe, con el mensaje. */
function describedBy(hintId: string, messageId: string, visible: boolean): string {
  if (visible) {
    return `${hintId} ${messageId}`;
  }
  return hintId;
}

/** F11 · Formulario de la solicitud: nota de 10 a 500 caracteres y `POST /api/me/teacher-request`. */
export function TeacherRequestForm() {
  const router = useRouter();
  const noteId = useId();
  const hintId = useId();
  const messageId = useId();
  const busy = useRef(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) {
      return;
    }
    const input = CreateTeacherRequestInputSchema.safeParse({ note });
    if (!input.success) {
      setError(INVALID_NOTE_ERROR);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    const failure = await postRequest(input.data);
    busy.current = false;
    setPending(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setSent(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Solicitar el rol de docente" className="grid gap-4">
      <div className="grid gap-1">
        <label htmlFor={noteId} className="font-medium">
          Institución, facultad o cargo
        </label>
        <textarea
          id={noteId}
          name="note"
          rows={4}
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-describedby={describedBy(hintId, messageId, error !== null || sent)}
          aria-invalid={error !== null}
          className="min-h-11 w-full rounded border border-control-border bg-surface px-3 py-2 text-ink"
        />
        <p id={hintId} className="text-sm text-ink-muted">
          {noteLength(note)} de {TEACHER_REQUEST_RULES.noteMax} caracteres (mínimo {TEACHER_REQUEST_RULES.noteMin}). El
          personal la usa para comprobar que eres docente.
        </p>
      </div>
      <Feedback error={error} sent={sent} id={messageId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70 md:w-auto md:justify-self-start"
      >
        Enviar solicitud
      </button>
    </form>
  );
}
