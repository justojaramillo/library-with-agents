"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { ApiErrorSchema } from "@/shared/schema";
import { type CreateStaffInput, CreateStaffInputSchema } from "../schema";

export const STAFF_DEFAULT_ERROR = "No se pudo crear la cuenta";
export const STAFF_INVALID_DATA_ERROR = "Revisa los datos del formulario.";

const MESSAGE_ID = "personal-mensaje";
const HINT_ID = "personal-ayuda";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";

/** Resultado del intento: nada, éxito (con el nombre) o mensaje de error. */
type Outcome = { kind: "idle" } | { kind: "created"; name: string } | { kind: "error"; message: string };

const IDLE: Outcome = { kind: "idle" };

function failure(message: string): Outcome {
  return { kind: "error", message };
}

/** Texto del aviso de éxito. */
export function createdMessage(name: string): string {
  return `Se creó la cuenta de ${name}.`;
}

/**
 * Mensaje de un alta rechazada: el del servidor si cumple el contrato; en un 400 de validación el texto genérico
 * «Datos inválidos» no ayuda, así que se muestra «Revisa los datos del formulario.». Cuerpo ilegible: el de respaldo.
 */
async function rejectionMessage(res: Response): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (!parsed.success) {
      return STAFF_DEFAULT_ERROR;
    }
    if (res.status === 400 && parsed.data.issues !== undefined) {
      return STAFF_INVALID_DATA_ERROR;
    }
    return parsed.data.error;
  } catch {
    // El cuerpo no era JSON: se usa el mensaje de respaldo.
  }
  return STAFF_DEFAULT_ERROR;
}

/** `POST /api/staff`: el rol no viaja, el servidor lo fija. */
async function submitStaff(input: CreateStaffInput): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return failure(STAFF_DEFAULT_ERROR);
  }
  if (!res.ok) {
    return failure(await rejectionMessage(res));
  }
  return { kind: "created", name: input.name };
}

/** Valida en el navegador con el contrato y envía. */
async function attemptCreate(form: FormData): Promise<Outcome> {
  const input = CreateStaffInputSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!input.success) {
    return failure(STAFF_INVALID_DATA_ERROR);
  }
  return submitStaff(input.data);
}

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  describedBy?: string;
  maxLength?: number;
  minLength?: number;
}

function TextField({ id, name, label, type, autoComplete, describedBy, maxLength, minLength }: TextFieldProps) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        maxLength={maxLength}
        minLength={minLength}
        className={INPUT_CLASS}
      />
    </div>
  );
}

/** Éxito en `role="status"` y error en `role="alert"`; nada si no hay. */
function StaffMessage({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "created") {
    return (
      <p id={MESSAGE_ID} role="status" className="font-medium text-success">
        {createdMessage(outcome.name)}
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

/** Enlaza el formulario con el error solo cuando existe. */
function errorDescribedBy(outcome: Outcome): string | undefined {
  if (outcome.kind === "error") {
    return MESSAGE_ID;
  }
  return undefined;
}

/**
 * F13 · Formulario «Crear bibliotecario» (solo lo ve el administrador; el servidor vuelve a comprobarlo). El rol no
 * se envía: la cuenta siempre nace como bibliotecario.
 */
export function StaffForm() {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) {
      return;
    }
    const form = e.currentTarget;
    setPending(true);
    setOutcome(IDLE);
    const result = await attemptCreate(new FormData(form));
    setOutcome(result);
    setPending(false);
    if (result.kind === "created") {
      form.reset();
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="personal-crear-titulo"
      aria-describedby={errorDescribedBy(outcome)}
      className="grid max-w-md gap-4"
    >
      <TextField id="staff-name" name="name" label="Nombre" type="text" autoComplete="name" maxLength={120} />
      <TextField id="staff-email" name="email" label="Correo" type="email" autoComplete="email" />
      <TextField
        id="staff-password"
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="new-password"
        describedBy={HINT_ID}
        minLength={8}
        maxLength={100}
      />
      <p id={HINT_ID} className="-mt-3 text-sm text-ink-muted">
        Entre 8 y 100 caracteres
      </p>
      <StaffMessage outcome={outcome} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70 md:w-auto"
      >
        Crear bibliotecario
      </button>
    </form>
  );
}
