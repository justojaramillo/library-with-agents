"use client";

import { useRef, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { TextField } from "@/shared/ui/text-field";
import { type CreateBookInput, CreateBookInputSchema } from "../schema";
import { readApiErrorMessage } from "./request-error";

export const BOOK_DEFAULT_ERROR = "No se pudo registrar el libro";
export const BOOK_INVALID_DATA_ERROR = "Revisa los datos del formulario.";
export const BOOK_SESSION_ENDED_ERROR = "Tu sesión terminó. Vuelve a ingresar.";
export const BOOK_DUPLICATE_ERROR = "Ya existe un libro con ese ISBN.";

const MESSAGE_ID = "libro-mensaje";

const BOOK_FIELDS = ["isbn", "title", "author", "copies"] as const;
type BookField = (typeof BOOK_FIELDS)[number];
type FieldErrors = Partial<Record<BookField, string>>;

/** Mensaje de cada campo cuando no cumple el contrato. */
const FIELD_MESSAGES: Record<BookField, string> = {
  isbn: "El ISBN debe tener 10 o 13 dígitos.",
  title: "Escribe el título (hasta 200 caracteres).",
  author: "Escribe el autor (hasta 120 caracteres).",
  copies: "Los ejemplares deben ser un número entero de 1 a 100.",
};

/** Resultado del intento: nada, datos inválidos, libro registrado o error del servidor. */
type Outcome =
  | { kind: "idle" }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "created"; title: string; copies: number }
  | { kind: "error"; message: string };

const IDLE: Outcome = { kind: "idle" };

/** Quita los guiones y los espacios del ISBN («978-84-376-0494-7» → «9788437604947»). */
export function normalizeIsbn(value: string): string {
  return value.replace(/[-\s]/g, "");
}

/** Texto del aviso de éxito. */
export function createdBookMessage(title: string, copies: number): string {
  if (copies === 1) {
    return `Se registró «${title}» con 1 ejemplar.`;
  }
  return `Se registró «${title}» con ${copies} ejemplares.`;
}

/** Error de `POST /api/books`: el estado HTTP y el mensaje que mandó el servidor (o el de respaldo). */
export class BookRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BookRequestError";
    this.status = status;
  }
}

/**
 * Mensaje para un error de registrar un libro: 409 → ISBN repetido; 400 → «Revisa los datos del formulario.»; 401 y
 * 403 → sesión terminada; otro error del servidor → su propio mensaje; cualquier otra cosa (red, cuerpo ilegible) →
 * «No se pudo registrar el libro». El `catch` lo pasa tal cual, sin anotarle tipo.
 */
export function messageForBookError<T>(error: T): string {
  if (!(error instanceof BookRequestError)) {
    return BOOK_DEFAULT_ERROR;
  }
  if (error.status === 409) {
    return BOOK_DUPLICATE_ERROR;
  }
  if (error.status === 400) {
    return BOOK_INVALID_DATA_ERROR;
  }
  if (error.status === 401 || error.status === 403) {
    return BOOK_SESSION_ENDED_ERROR;
  }
  return error.message;
}

/** Texto de un campo del formulario; vacío si falta. */
function readText(form: FormData, name: BookField): string {
  const value = form.get(name);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

/** Ejemplares: solo dígitos; todo lo demás (vacío, decimal, letras) queda como `NaN` y el contrato lo rechaza. */
function parseCopies(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return Number.NaN;
}

function isBookField<T>(key: T): key is T & BookField {
  return BOOK_FIELDS.some((field) => field === key);
}

/** Un mensaje por cada campo que el contrato rechazó. */
function collectErrors(issues: { path: PropertyKey[] }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (isBookField(key)) {
      errors[key] = FIELD_MESSAGES[key];
    }
  }
  return errors;
}

/** `POST /api/books`. Si falla lanza `BookRequestError`; un fallo de red sube tal cual. */
async function postBook(input: CreateBookInput): Promise<void> {
  const res = await fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new BookRequestError(res.status, await readApiErrorMessage(res, BOOK_DEFAULT_ERROR));
  }
}

/** Normaliza el ISBN, valida con el contrato (sin llamar al servidor si hay errores) y envía. */
async function attemptRegister(form: FormData): Promise<Outcome> {
  const input = CreateBookInputSchema.safeParse({
    isbn: normalizeIsbn(readText(form, "isbn")),
    title: readText(form, "title"),
    author: readText(form, "author"),
    copies: parseCopies(readText(form, "copies")),
  });
  if (!input.success) {
    return { kind: "invalid", errors: collectErrors(input.error.issues) };
  }
  try {
    await postBook(input.data);
  } catch (error) {
    return { kind: "error", message: messageForBookError(error) };
  }
  return { kind: "created", title: input.data.title, copies: input.data.copies };
}

/** Lleva el foco al campo indicado. */
function focusField(form: HTMLFormElement, name: BookField) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) {
    field.focus();
  }
}

/** Primer campo (en el orden del formulario) con error. */
function firstInvalidField(errors: FieldErrors): BookField | undefined {
  return BOOK_FIELDS.find((field) => errors[field] !== undefined);
}

/** Éxito en `role="status"` y error en `role="alert"`; nada si no hay. */
function BookMessage({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "created") {
    return (
      <p id={MESSAGE_ID} role="status" className="font-medium text-success">
        {createdBookMessage(outcome.title, outcome.copies)}
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p id={MESSAGE_ID} role="alert" className="font-medium text-danger">
        {outcome.message}
      </p>
    );
  }
  return null;
}

/** Errores por campo del último intento; ninguno si no fue inválido. */
function fieldErrorsOf(outcome: Outcome): FieldErrors {
  if (outcome.kind === "invalid") {
    return outcome.errors;
  }
  return {};
}

/** Enlaza el formulario con el error del servidor solo cuando existe. */
function errorDescribedBy(outcome: Outcome): string | undefined {
  if (outcome.kind === "error") {
    return MESSAGE_ID;
  }
  return undefined;
}

/** F36 · Formulario «Registrar libro» (solo lo ve el personal; el servidor vuelve a comprobarlo). */
export function BookForm() {
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) {
      return;
    }
    const form = e.currentTarget;
    sending.current = true;
    setPending(true);
    setOutcome(IDLE);
    const result = await attemptRegister(new FormData(form));
    sending.current = false;
    setPending(false);
    setOutcome(result);
    if (result.kind === "created") {
      form.reset();
      focusField(form, "isbn");
    }
    if (result.kind === "invalid") {
      const first = firstInvalidField(result.errors);
      if (first !== undefined) {
        focusField(form, first);
      }
    }
  }

  const errors = fieldErrorsOf(outcome);
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-label="Registrar libro"
      aria-describedby={errorDescribedBy(outcome)}
      className="grid max-w-md gap-4"
    >
      <TextField
        id="libro-isbn"
        name="isbn"
        label="ISBN"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        hint="10 o 13 dígitos"
        error={errors.isbn}
      />
      <TextField id="libro-title" name="title" label="Título" type="text" autoComplete="off" error={errors.title} />
      <TextField id="libro-autor" name="author" label="Autor" type="text" autoComplete="off" error={errors.author} />
      <TextField
        id="libro-ejemplares"
        name="copies"
        label="Ejemplares"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        defaultValue="1"
        error={errors.copies}
      />
      <BookMessage outcome={outcome} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70 md:w-auto"
      >
        Registrar libro
      </button>
    </form>
  );
}
