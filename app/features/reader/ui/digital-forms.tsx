"use client";

import { useId, useRef, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { DIGITAL_RULES, type DigitalInfo } from "../schema";
import { saveDigitalCopies } from "./digital-api";
import {
  DigitalMessage,
  IDLE_OUTCOME,
  errorDescribedBy,
  joinDescribedBy,
  type DigitalOutcome,
} from "./digital-message";
import { COPIES_INVALID_ERROR, messageForDigitalError, parseDigitalCopies, savedCopiesMessage } from "./digital-state";

export type DigitalFormProps = { info: DigitalInfo; onUpdated: (info: DigitalInfo) => void };

const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink md:max-w-40";

/** Envía las copias y devuelve el resultado para mostrarlo; no lanza. */
async function submitCopies(
  info: DigitalInfo,
  copies: number,
): Promise<{ outcome: DigitalOutcome; updated: DigitalInfo | null }> {
  try {
    const updated = await saveDigitalCopies(info.book_id, { digital_copies: copies });
    return { outcome: { kind: "done", text: savedCopiesMessage(updated.title, updated.digital_copies) }, updated };
  } catch (caught) {
    return { outcome: { kind: "error", message: messageForDigitalError(caught) }, updated: null };
  }
}

function useCopiesForm({ info, onUpdated }: DigitalFormProps) {
  const [value, setValue] = useState(String(info.digital_copies));
  const [outcome, setOutcome] = useState<DigitalOutcome>(IDLE_OUTCOME);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  async function submit() {
    if (busy.current) {
      return;
    }
    const copies = parseDigitalCopies(value);
    if (copies === null) {
      setOutcome({ kind: "error", message: COPIES_INVALID_ERROR });
      return;
    }
    busy.current = true;
    setSending(true);
    setOutcome(IDLE_OUTCOME);
    const result = await submitCopies(info, copies);
    busy.current = false;
    setSending(false);
    setOutcome(result.outcome);
    if (result.updated !== null) {
      setValue(String(result.updated.digital_copies));
      onUpdated(result.updated);
    }
  }

  return { value, setValue, outcome, sending, submit };
}

/** Formulario «Copias digitales» (regla 13): número de 0 a 100 y «Guardar copias». */
export function CopiesForm(props: DigitalFormProps) {
  const headingId = useId();
  const inputId = useId();
  const hintId = useId();
  const messageId = useId();
  const form = useCopiesForm(props);

  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded border border-line p-4">
      <h3 id={headingId} className="text-lg font-semibold">
        Copias digitales
      </h3>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
        className="grid gap-3"
      >
        <div className="grid gap-1">
          <label htmlFor={inputId} className="font-medium">
            Copias digitales (de 0 a {DIGITAL_RULES.maxCopies})
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            max={DIGITAL_RULES.maxCopies}
            step={1}
            value={form.value}
            onChange={(e) => form.setValue(e.target.value)}
            aria-invalid={form.outcome.kind === "error"}
            aria-describedby={joinDescribedBy([hintId, errorDescribedBy(form.outcome, messageId)])}
            className={INPUT_CLASS}
          />
          <p id={hintId} className="text-sm text-ink-muted">
            Cuántas personas pueden leerlo a la vez. Con 0 deja de prestarse en digital y el contenido se conserva.
          </p>
        </div>
        <DigitalMessage outcome={form.outcome} id={messageId} />
        <button
          type="submit"
          disabled={form.sending}
          className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border md:w-auto md:justify-self-start"
        >
          Guardar copias
        </button>
      </form>
    </section>
  );
}
