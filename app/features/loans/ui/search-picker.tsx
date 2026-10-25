"use client";

import { useId, useRef, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import type { z } from "zod";
import { readErrorMessage } from "./api-client";

const MIN_CHARS = 2;
/** Se pide un resultado de más para saber si hay más de los que se muestran. */
export const SUGGESTION_LIMIT = 10;
const SEARCH_ERROR = "No se pudo buscar";
const BUTTON_CLASS =
  "min-h-11 min-w-11 rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:cursor-not-allowed";
const SECONDARY_BUTTON_CLASS =
  "min-h-11 min-w-11 rounded border border-control-border bg-surface px-4 font-medium text-ink hover:bg-surface-alt";

type SearchState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "results"; items: T[]; more: boolean; truncated: boolean };

type FetchResult<T> = { ok: true; items: T[]; truncated: boolean } | { ok: false; message: string };

/** La API marca con esta cabecera que la búsqueda leyó el tope de documentos (S1, regla 7). */
const TRUNCATED_HEADER = "X-Search-Truncated";

/** Pide las sugerencias y valida la respuesta con el esquema en el mismo punto de lectura. */
async function fetchSuggestions<T>(url: string, schema: z.ZodType<T[]>): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, message: await readErrorMessage(res, SEARCH_ERROR) };
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      return { ok: false, message: SEARCH_ERROR };
    }
    return { ok: true, items: parsed.data, truncated: res.headers.get(TRUNCATED_HEADER) === "1" };
  } catch {
    return { ok: false, message: SEARCH_ERROR };
  }
}

export type SearchPickerProps<T> = {
  /** Etiqueta del campo, p. ej. «Buscar persona (nombre o correo)». */
  label: string;
  /** Texto antes de la elección, p. ej. «Persona seleccionada». */
  selectedLabel: string;
  /** Dirección de la búsqueda para un texto ya recortado (ya pide `limit=11`). */
  buildUrl: (q: string) => string;
  schema: z.ZodType<T[]>;
  selected: T | null;
  onSelect: (item: T) => void;
  onClear: () => void;
  /** «Nombre — correo» de la elección. */
  describe: (item: T) => string;
  /** Texto de una sugerencia. */
  suggestionText: (item: T) => string;
  /** Si es verdadero la sugerencia se muestra pero no se puede elegir. */
  isUnavailable?: (item: T) => boolean;
  getKey: (item: T) => string;
};

/** Estado y acciones de la búsqueda; solo vale la respuesta de la última petición. */
function useSuggestions<T>(buildUrl: (q: string) => string, schema: z.ZodType<T[]>) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState<T>>({ kind: "idle" });
  const latest = useRef(0);

  async function run() {
    const q = query.trim();
    latest.current += 1;
    const ticket = latest.current;
    if (q.length < MIN_CHARS) {
      setState({ kind: "error", message: "Escribe al menos 2 letras." });
      return;
    }
    setState({ kind: "loading" });
    const result = await fetchSuggestions(buildUrl(q), schema);
    if (ticket !== latest.current) {
      return;
    }
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({
      kind: "results",
      items: result.items.slice(0, SUGGESTION_LIMIT),
      more: result.items.length > SUGGESTION_LIMIT,
      truncated: result.truncated,
    });
  }

  /** Descarta cualquier respuesta pendiente y limpia el campo y la lista. */
  function reset() {
    latest.current += 1;
    setQuery("");
    setState({ kind: "idle" });
  }

  return { query, setQuery, state, run, reset };
}

function Feedback<T>({ state, id }: { state: SearchState<T>; id: string }) {
  if (state.kind === "loading") {
    return (
      <p id={id} role="status" className="text-ink-muted">
        Buscando…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p id={id} role="alert" className="font-medium text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind === "results" && state.items.length === 0) {
    return (
      <p id={id} className="text-ink-muted">
        No hay coincidencias.
      </p>
    );
  }
  if (state.kind === "results" && state.more) {
    return (
      <p id={id} className="text-ink-muted">
        Hay más resultados: escribe más para afinar.
      </p>
    );
  }
  return null;
}

/** Aviso aparte del resto: la lista puede estar completa y aun así haber más coincidencias sin leer. */
function TruncatedNotice<T>({ state }: { state: SearchState<T> }) {
  if (state.kind !== "results" || !state.truncated) {
    return null;
  }
  return (
    <p role="status" className="text-ink-muted">
      Puede haber más coincidencias: escribe más para afinar.
    </p>
  );
}

function announcement<T>(state: SearchState<T>): string {
  if (state.kind !== "results" || state.items.length === 0) {
    return "";
  }
  if (state.items.length === 1) {
    return "1 sugerencia";
  }
  return `${state.items.length} sugerencias`;
}

function describedBy(hasFeedback: boolean, id: string): string | undefined {
  if (!hasFeedback) {
    return undefined;
  }
  return id;
}

/** Elección hecha: se muestra y se puede cambiar. */
function SelectedView({ label, text, onClear }: { label: string; text: string; onClear: () => void }) {
  return (
    <div className="grid gap-2">
      <p>
        {label}: <strong className="break-words">{text}</strong>
      </p>
      <button type="button" onClick={onClear} className={`${SECONDARY_BUTTON_CLASS} justify-self-start`}>
        Cambiar
      </button>
    </div>
  );
}

/**
 * Buscador con botón y lista de sugerencias (regla 5 de F34). Enter dentro del campo busca y no envía
 * el formulario que lo contenga; las sugerencias son botones, así que se eligen con clic o con teclado.
 */
export function SearchPicker<T>(props: SearchPickerProps<T>) {
  const { selected, onSelect, onClear, isUnavailable } = props;
  const inputId = useId();
  const feedbackId = useId();
  const { query, setQuery, state, run, reset } = useSuggestions(props.buildUrl, props.schema);

  if (selected !== null) {
    const clear = () => {
      reset();
      onClear();
    };
    return <SelectedView label={props.selectedLabel} text={props.describe(selected)} onClear={clear} />;
  }

  const choose = (item: T) => {
    reset();
    onSelect(item);
  };
  const hasFeedback = state.kind !== "idle" && !(state.kind === "results" && !state.more && state.items.length > 0);

  return (
    <div className="grid gap-2">
      <label htmlFor={inputId} className="font-medium">
        {props.label}
      </label>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          id={inputId}
          type="text"
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          aria-describedby={describedBy(hasFeedback, feedbackId)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          className="min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink"
        />
        <button type="button" onClick={() => void run()} className={BUTTON_CLASS}>
          Buscar
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement(state)}
      </p>
      <Feedback state={state} id={feedbackId} />
      <TruncatedNotice state={state} />
      {state.kind === "results" && (
        <ul className="grid gap-2">
          {state.items.map((item) => (
            <li key={props.getKey(item)}>
              <button
                type="button"
                disabled={isUnavailable?.(item) === true}
                onClick={() => choose(item)}
                className="min-h-11 w-full rounded border border-control-border bg-surface px-3 py-2 text-left break-words text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted"
              >
                {props.suggestionText(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
