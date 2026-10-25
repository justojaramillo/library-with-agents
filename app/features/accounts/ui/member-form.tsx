"use client";

import { useRef, useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { TextField } from "@/shared/ui/text-field";
import { type CreateMemberInput, CreateMemberInputSchema } from "../schema";
import { readRequestErrorMessage } from "./request-error";

export const MEMBER_DEFAULT_ERROR = "No se pudo crear la cuenta";
export const MEMBER_INVALID_DATA_ERROR = "Revisa los datos del formulario.";
export const MEMBER_SESSION_ENDED_ERROR = "Tu sesión terminó. Vuelve a ingresar.";
export const MEMBER_DUPLICATE_ERROR = "Ya existe una cuenta con ese correo.";

const MESSAGE_ID = "cuenta-mensaje";
const ROLE_ERROR_ID = "cuenta-rol-error";

const MEMBER_FIELDS = ["name", "email", "password", "role"] as const;
type MemberField = (typeof MEMBER_FIELDS)[number];
type FieldErrors = Partial<Record<MemberField, string>>;

/** Mensaje de cada campo cuando no cumple el contrato. */
const FIELD_MESSAGES: Record<MemberField, string> = {
  name: "Escribe el nombre (hasta 120 caracteres).",
  email: "Escribe un correo válido (hasta 254 caracteres).",
  password: "La contraseña debe tener entre 8 y 100 caracteres.",
  role: "Elige el tipo de cuenta: externo o estudiante.",
};

/** Resultado del intento: nada, datos inválidos, cuenta creada o error del servidor. */
type Outcome =
  | { kind: "idle" }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "created"; name: string }
  | { kind: "error"; message: string };

const IDLE: Outcome = { kind: "idle" };

/** Texto del aviso de éxito. */
export function createdMemberMessage(name: string): string {
  return `Se creó la cuenta de ${name}. Entrégale el correo y la contraseña; puede cambiarla después.`;
}

/** Error de `POST /api/members`: el estado HTTP y el mensaje que mandó el servidor (o el de respaldo). */
export class MemberRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MemberRequestError";
    this.status = status;
  }
}

/**
 * Mensaje para un error de crear una cuenta: 409 → correo repetido; 400 → «Revisa los datos del formulario.»; 401 y
 * 403 → sesión terminada; otro error del servidor → su propio mensaje; cualquier otra cosa (red, cuerpo ilegible) →
 * «No se pudo crear la cuenta». El `catch` lo pasa tal cual, sin anotarle tipo.
 */
export function messageForMemberError<T>(error: T): string {
  if (!(error instanceof MemberRequestError)) {
    return MEMBER_DEFAULT_ERROR;
  }
  if (error.status === 409) {
    return MEMBER_DUPLICATE_ERROR;
  }
  if (error.status === 400) {
    return MEMBER_INVALID_DATA_ERROR;
  }
  if (error.status === 401 || error.status === 403) {
    return MEMBER_SESSION_ENDED_ERROR;
  }
  return error.message;
}

/** Texto de un campo del formulario; vacío si falta. */
function readText(form: FormData, name: MemberField): string {
  const value = form.get(name);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function isMemberField<T>(key: T): key is T & MemberField {
  return MEMBER_FIELDS.some((field) => field === key);
}

/** Un mensaje por cada campo que el contrato rechazó. */
function collectErrors(issues: { path: PropertyKey[] }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (isMemberField(key)) {
      errors[key] = FIELD_MESSAGES[key];
    }
  }
  return errors;
}

/** `POST /api/members`. Si falla lanza `MemberRequestError`; un fallo de red sube tal cual. */
async function postMember(input: CreateMemberInput): Promise<void> {
  const res = await fetch("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new MemberRequestError(res.status, await readRequestErrorMessage(res, MEMBER_DEFAULT_ERROR));
  }
}

/** Valida con el contrato (sin llamar al servidor si hay errores) y envía. */
async function attemptCreate(form: FormData): Promise<Outcome> {
  const input = CreateMemberInputSchema.safeParse({
    name: readText(form, "name"),
    email: readText(form, "email"),
    password: readText(form, "password"),
    role: readText(form, "role"),
  });
  if (!input.success) {
    return { kind: "invalid", errors: collectErrors(input.error.issues) };
  }
  try {
    await postMember(input.data);
  } catch (error) {
    return { kind: "error", message: messageForMemberError(error) };
  }
  return { kind: "created", name: input.data.name };
}

/** Lleva el foco al campo indicado. */
function focusField(form: HTMLFormElement, name: MemberField) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) {
    field.focus();
  }
}

/** Primer campo (en el orden del formulario) con error. */
function firstInvalidField(errors: FieldErrors): MemberField | undefined {
  return MEMBER_FIELDS.find((field) => errors[field] !== undefined);
}

/** Éxito en `role="status"` y error en `role="alert"`; nada si no hay. */
function MemberMessage({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "created") {
    return (
      <p id={MESSAGE_ID} role="status" className="font-medium text-success">
        {createdMemberMessage(outcome.name)}
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

/** Enlaza el grupo de opciones con su error solo cuando existe. */
function roleDescribedBy(error: string | undefined): string | undefined {
  if (error === undefined) {
    return undefined;
  }
  return ROLE_ERROR_ID;
}

/** Error del grupo de opciones; nada si no hay. */
function RoleError({ error }: { error: string | undefined }) {
  if (error === undefined) {
    return null;
  }
  return (
    <p id={ROLE_ERROR_ID} role="alert" className="text-sm font-medium text-danger">
      {error}
    </p>
  );
}

/** Tipo de cuenta: solo las dos opciones que acepta el servidor (docente y personal tienen su propio camino). */
function RoleFieldset({ error }: { error: string | undefined }) {
  return (
    <fieldset aria-describedby={roleDescribedBy(error)} className="grid gap-1">
      <legend className="font-medium">Tipo de cuenta</legend>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="role" value="EXTERNO" defaultChecked className="size-5 accent-primary" />
        Externo
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="role" value="ESTUDIANTE" className="size-5 accent-primary" />
        Estudiante
      </label>
      <RoleError error={error} />
    </fieldset>
  );
}

/** F36 · Formulario «Nueva cuenta» de mostrador (solo lo ve el personal; el servidor vuelve a comprobarlo). */
export function MemberForm() {
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
    const result = await attemptCreate(new FormData(form));
    sending.current = false;
    setPending(false);
    setOutcome(result);
    if (result.kind === "created") {
      form.reset();
      focusField(form, "name");
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
      aria-label="Nueva cuenta"
      aria-describedby={errorDescribedBy(outcome)}
      className="grid max-w-md gap-4"
    >
      <TextField id="cuenta-nombre" name="name" label="Nombre" type="text" autoComplete="off" error={errors.name} />
      <TextField id="cuenta-correo" name="email" label="Correo" type="email" autoComplete="off" error={errors.email} />
      <TextField
        id="cuenta-contrasena"
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="new-password"
        hint="Entre 8 y 100 caracteres"
        error={errors.password}
      />
      <RoleFieldset error={errors.role} />
      <MemberMessage outcome={outcome} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70 md:w-auto"
      >
        Crear cuenta
      </button>
    </form>
  );
}
