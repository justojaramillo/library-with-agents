"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import type { DigitalInfo } from "../schema";
import { uploadDigitalContent } from "./digital-api";
import {
  DigitalMessage,
  IDLE_OUTCOME,
  errorDescribedBy,
  joinDescribedBy,
  type DigitalOutcome,
} from "./digital-message";
import {
  FILE_MISSING_ERROR,
  formatKilobytes,
  isAllowedFileName,
  messageForDigitalError,
  readMarkdownFile,
  uploadedContentMessage,
} from "./digital-state";

type ContentFormProps = { info: DigitalInfo; onUpdated: (info: DigitalInfo) => void };

const PRIMARY_CLASS =
  "min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-control-border md:w-auto";
const SECONDARY_CLASS =
  "min-h-11 w-full rounded border border-control-border bg-surface px-4 font-medium text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-muted md:w-auto";
const REPLACE_NOTICE =
  "Este libro ya tiene contenido. Si lo reemplazas, quien lo esté leyendo verá la versión nueva en su siguiente página.";

/** Mensaje de por qué el archivo no sirve (extensión, vacío o más de 2 MB), o `null` si se puede enviar. */
async function checkFile(file: File): Promise<string | null> {
  if (!isAllowedFileName(file.name)) {
    return FILE_MISSING_ERROR;
  }
  const read = await readMarkdownFile(file);
  if (!read.ok) {
    return read.message;
  }
  return null;
}

/** Vuelve a leer el archivo (pudo cambiar desde que se eligió) y lo envía; no lanza. */
async function sendFile(
  info: DigitalInfo,
  file: File,
): Promise<{ outcome: DigitalOutcome; updated: DigitalInfo | null }> {
  const read = await readMarkdownFile(file);
  if (!read.ok) {
    return { outcome: { kind: "error", message: read.message }, updated: null };
  }
  try {
    const updated = await uploadDigitalContent(info.book_id, { markdown: read.text });
    return { outcome: { kind: "done", text: uploadedContentMessage(updated) }, updated };
  } catch (caught) {
    return { outcome: { kind: "error", message: messageForDigitalError(caught) }, updated: null };
  }
}

function useContentForm({ info, onUpdated }: ContentFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [outcome, setOutcome] = useState<DigitalOutcome>(IDLE_OUTCOME);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const latestPick = useRef(0);

  /** Elegir otro archivo (o ninguno) empieza de cero; solo vale la última elección. */
  async function pick(next: File | null) {
    latestPick.current += 1;
    const ticket = latestPick.current;
    setConfirming(false);
    setOutcome(IDLE_OUTCOME);
    setFile(null);
    if (next === null) {
      return;
    }
    const message = await checkFile(next);
    if (ticket !== latestPick.current) {
      return;
    }
    if (message !== null) {
      setOutcome({ kind: "error", message });
      return;
    }
    setFile(next);
  }

  async function submit() {
    if (busy.current) {
      return;
    }
    if (file === null) {
      if (outcome.kind !== "error") {
        setOutcome({ kind: "error", message: FILE_MISSING_ERROR });
      }
      return;
    }
    if (info.has_content && !confirming) {
      setConfirming(true);
      return;
    }
    busy.current = true;
    setSending(true);
    setOutcome(IDLE_OUTCOME);
    const result = await sendFile(info, file);
    busy.current = false;
    setSending(false);
    setConfirming(false);
    setOutcome(result.outcome);
    if (result.updated !== null) {
      setFile(null);
      setInputKey((key) => key + 1);
      onUpdated(result.updated);
    }
  }

  return { file, inputKey, outcome, confirming, sending, pick, submit, cancel: () => setConfirming(false) };
}

/** Segundo paso del reemplazo: el foco cae en «Cancelar», la opción segura. */
function ReplaceConfirm(props: { busy: boolean; noticeId: string; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <>
      <button type="submit" disabled={props.busy} aria-describedby={props.noticeId} className={PRIMARY_CLASS}>
        Confirmar reemplazo
      </button>
      <button ref={cancelRef} type="button" disabled={props.busy} onClick={props.onCancel} className={SECONDARY_CLASS}>
        Cancelar
      </button>
    </>
  );
}

/** Primer paso: «Subir contenido» (sin contenido previo) o «Reemplazar contenido». */
function StartButton({
  replace,
  busy,
  buttonRef,
}: {
  replace: boolean;
  busy: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  let label = "Subir contenido";
  if (replace) {
    label = "Reemplazar contenido";
  }
  return (
    <button ref={buttonRef} type="submit" disabled={busy} className={PRIMARY_CLASS}>
      {label}
    </button>
  );
}

/** El primer archivo elegido en el campo, o `null` si no hay. */
function pickedFile(files: FileList | null): File | null {
  if (files === null) {
    return null;
  }
  return files.item(0);
}

function fileDescribedBy(file: File | null, id: string): string | undefined {
  if (file === null) {
    return undefined;
  }
  return id;
}

function FileSummary({ file, id }: { file: File | null; id: string }) {
  if (file === null) {
    return null;
  }
  return (
    <p id={id} className="break-words text-ink-muted">
      Archivo elegido: <strong>{file.name}</strong> ({formatKilobytes(file.size)})
    </p>
  );
}

function ReplaceNotice({ visible, id }: { visible: boolean; id: string }) {
  if (!visible) {
    return null;
  }
  return (
    <p id={id} className="font-medium text-warning">
      {REPLACE_NOTICE}
    </p>
  );
}

type ActionsProps = {
  hasContent: boolean;
  confirming: boolean;
  sending: boolean;
  noticeId: string;
  onCancel: () => void;
};

function ContentActions({ hasContent, confirming, sending, noticeId, onCancel }: ActionsProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Al cancelar, el foco vuelve al botón del primer paso.
  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      startRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);
  if (confirming) {
    return <ReplaceConfirm busy={sending} noticeId={noticeId} onCancel={onCancel} />;
  }
  return <StartButton replace={hasContent} busy={sending} buttonRef={startRef} />;
}

/**
 * Formulario «Contenido» (reglas 13 y 14): archivo `.md`, `.markdown` o `.txt` leído en el navegador y validado antes
 * de enviar; reemplazar pide confirmación en dos pasos.
 */
export function ContentForm(props: ContentFormProps) {
  const headingId = useId();
  const inputId = useId();
  const hintId = useId();
  const fileId = useId();
  const noticeId = useId();
  const messageId = useId();
  const form = useContentForm(props);
  const describedBy = joinDescribedBy([
    hintId,
    fileDescribedBy(form.file, fileId),
    errorDescribedBy(form.outcome, messageId),
  ]);

  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded border border-line p-4">
      <h3 id={headingId} className="text-lg font-semibold">
        Contenido
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
            Archivo del libro (.md, .markdown o .txt)
          </label>
          <input
            key={form.inputKey}
            id={inputId}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            disabled={form.sending}
            onChange={(e) => void form.pick(pickedFile(e.target.files))}
            aria-invalid={form.outcome.kind === "error"}
            aria-describedby={describedBy}
            className="min-h-11 w-full rounded border border-control-border bg-surface p-2 text-ink"
          />
          <p id={hintId} className="text-sm text-ink-muted">
            Texto en UTF-8, de hasta 2 MB. Se guarda tal cual; no hay vista previa.
          </p>
        </div>
        <FileSummary file={form.file} id={fileId} />
        <ReplaceNotice visible={form.confirming} id={noticeId} />
        <DigitalMessage outcome={form.outcome} id={messageId} />
        <div className="grid gap-2 md:flex md:flex-wrap">
          <ContentActions
            hasContent={props.info.has_content}
            confirming={form.confirming}
            sending={form.sending}
            noticeId={noticeId}
            onCancel={form.cancel}
          />
        </div>
      </form>
    </section>
  );
}
