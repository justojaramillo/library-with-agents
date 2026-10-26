"use client";

import { useEffect, useId, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import type { Book } from "@/features/catalog/schema";
import type { DigitalInfo } from "../schema";
import { fetchDigitalInfo } from "./digital-api";
import { DigitalBookPicker } from "./digital-book-picker";
import { ContentForm } from "./digital-content-form";
import { CopiesForm } from "./digital-forms";
import { describeDigitalState, messageForDigitalError } from "./digital-state";

type InfoState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; info: DigitalInfo };

const SECONDARY_CLASS =
  "min-h-11 min-w-11 rounded border border-control-border bg-surface px-4 font-medium text-ink hover:bg-surface-alt";

/** Lee el estado digital del libro; `retry` lo vuelve a pedir tras un error. */
function useDigitalInfo(bookId: string) {
  const [state, setState] = useState<InfoState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const info = await fetchDigitalInfo(bookId);
        if (active) {
          setState({ kind: "ready", info });
        }
      } catch (caught) {
        if (active) {
          setState({ kind: "error", message: messageForDigitalError(caught) });
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [bookId, attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }

  return {
    state,
    retry,
    update: (info: DigitalInfo) => setState({ kind: "ready", info }),
  };
}

/** Las dos líneas del estado actual: copias y contenido. */
function DigitalStateList({ info }: { info: DigitalInfo }) {
  const text = describeDigitalState(info);
  return (
    <ul className="grid gap-1">
      <li>{text.copies}</li>
      <li>{text.content}</li>
    </ul>
  );
}

function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid gap-2">
      <p role="alert" className="font-medium text-danger">
        {message}
      </p>
      <button type="button" onClick={onRetry} className={`${SECONDARY_CLASS} justify-self-start`}>
        Reintentar
      </button>
    </div>
  );
}

type BodyProps = { state: InfoState; retry: () => void; update: (info: DigitalInfo) => void };

function PanelBody({ state, retry, update }: BodyProps) {
  if (state.kind === "loading") {
    return <p role="status">Cargando el estado del libro…</p>;
  }
  if (state.kind === "error") {
    return <LoadFailure message={state.message} onRetry={retry} />;
  }
  return (
    <>
      <DigitalStateList info={state.info} />
      <div className="grid gap-4 md:grid-cols-2">
        <CopiesForm info={state.info} onUpdated={update} />
        <ContentForm info={state.info} onUpdated={update} />
      </div>
    </>
  );
}

/** Panel del libro elegido (regla 13): su estado y los dos formularios. Se vuelve a montar al cambiar de libro. */
function SelectedBookPanel({ book }: { book: Book }) {
  const headingId = useId();
  const { state, retry, update } = useDigitalInfo(book.id);
  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <h2 id={headingId} className="text-xl font-semibold break-words">
        {book.title}
      </h2>
      <PanelBody state={state} retry={retry} update={update} />
    </section>
  );
}

/** F27 · Contenido digital: elegir el libro y administrar sus copias digitales y su archivo. */
export function DigitalPanel() {
  const [book, setBook] = useState<Book | null>(null);
  return (
    <div className="grid gap-6">
      <DigitalBookPicker selected={book} onSelect={setBook} onClear={() => setBook(null)} />
      {book !== null && <SelectedBookPanel key={book.id} book={book} />}
    </div>
  );
}
