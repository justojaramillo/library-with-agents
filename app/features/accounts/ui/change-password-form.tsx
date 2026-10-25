"use client";

import { FirebaseError } from "firebase/app";
import Link from "next/link";
import { useRef, useState } from "react";
// Primero `auth-client`: fija Zod sin compilación antes de crear los esquemas (CSP).
import { SessionRenewalError, changePassword } from "./auth-client";
import { ChangePasswordInputSchema } from "../schema";

const CURRENT_WRONG = "La contraseña actual es incorrecta.";
const TOO_MANY_MESSAGE = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
const WEAK_MESSAGE = "La nueva contraseña es demasiado débil.";
const RECENT_LOGIN_MESSAGE = "Vuelve a ingresar e inténtalo de nuevo.";
const DEFAULT_ERROR = "No se pudo cambiar la contraseña. Inténtalo de nuevo.";
const RENEWAL_MESSAGE = "Tu contraseña se cambió. Vuelve a ingresar con la nueva.";
const SUCCESS_MESSAGE = "Tu contraseña se cambió.";
const MISMATCH_MESSAGE = "Las contraseñas no coinciden.";
const CURRENT_REQUIRED = "Escribe tu contraseña actual.";
const NEW_LENGTH_MESSAGE = "La nueva contraseña debe tener entre 8 y 100 caracteres.";
const MUST_DIFFER_MESSAGE = "La nueva contraseña debe ser distinta de la actual.";
const MESSAGE_ID = "contrasena-mensaje";
const HELP_ID = "contrasena-ayuda";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

/** Mensaje por código de Firebase; cualquier otro código usa el genérico. */
const PASSWORD_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "auth/invalid-credential": CURRENT_WRONG,
  "auth/wrong-password": CURRENT_WRONG,
  "auth/too-many-requests": TOO_MANY_MESSAGE,
  "auth/weak-password": WEAK_MESSAGE,
  "auth/requires-recent-login": RECENT_LOGIN_MESSAGE,
};

/** Mensaje en español para un error al cambiar la contraseña. El `catch` pasa el error tal cual. */
export function messageForPasswordError<T>(error: T): string {
  if (error instanceof SessionRenewalError) {
    return RENEWAL_MESSAGE;
  }
  if (!(error instanceof FirebaseError)) {
    return DEFAULT_ERROR;
  }
  return PASSWORD_ERROR_MESSAGES[error.code] ?? DEFAULT_ERROR;
}

/** Resultado del envío: lo que se muestra debajo de los campos. */
type PasswordResult =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "renewal_failed" }
  | { kind: "success" };

const IDLE: PasswordResult = { kind: "idle" };

interface PasswordFields {
  current: string;
  next: string;
}

/** Valida en el navegador con el contrato; devuelve los campos o el mensaje del primer problema. */
function validateFields(form: FormData): PasswordFields | string {
  const input = ChangePasswordInputSchema.safeParse({
    current_password: form.get("current_password"),
    new_password: form.get("new_password"),
  });
  if (!input.success) {
    const issues = input.error.issues;
    if (issues.some((issue) => issue.path[0] === "current_password")) {
      return CURRENT_REQUIRED;
    }
    if (issues.some((issue) => issue.code !== "custom")) {
      return NEW_LENGTH_MESSAGE;
    }
    return MUST_DIFFER_MESSAGE;
  }
  if (form.get("confirm_password") !== input.data.new_password) {
    return MISMATCH_MESSAGE;
  }
  return { current: input.data.current_password, next: input.data.new_password };
}

/** Llama a Firebase y traduce el resultado. Solo se invoca con campos ya validados. */
async function submitChange(email: string, fields: PasswordFields): Promise<PasswordResult> {
  try {
    await changePassword(email, fields.current, fields.next);
    return { kind: "success" };
  } catch (caught) {
    if (caught instanceof SessionRenewalError) {
      return { kind: "renewal_failed" };
    }
    return { kind: "error", message: messageForPasswordError(caught) };
  }
}

/** Enlaza el formulario con el mensaje visible solo cuando existe. */
function describedBy(result: PasswordResult): string | undefined {
  if (result.kind === "idle") {
    return undefined;
  }
  return MESSAGE_ID;
}

function ResultMessage({ result }: { result: PasswordResult }) {
  if (result.kind === "error") {
    return (
      <p id={MESSAGE_ID} role="alert" className="font-medium text-danger">
        {result.message}
      </p>
    );
  }
  if (result.kind === "renewal_failed") {
    return (
      <p id={MESSAGE_ID} role="alert" className="font-medium text-danger">
        {RENEWAL_MESSAGE}{" "}
        <Link href="/login" className={LINK_CLASS}>
          Ir a ingresar
        </Link>
      </p>
    );
  }
  if (result.kind === "success") {
    return (
      <p id={MESSAGE_ID} role="status" className="font-medium text-success">
        {SUCCESS_MESSAGE}
      </p>
    );
  }
  return null;
}

interface PasswordFieldProps {
  id: string;
  label: string;
  autoComplete: string;
  describedById?: string;
}

function PasswordField({ id, label, autoComplete, describedById }: PasswordFieldProps) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="password"
        required
        autoComplete={autoComplete}
        aria-describedby={describedById}
        className={INPUT_CLASS}
      />
    </div>
  );
}

export function ChangePasswordForm({ email }: { email: string }) {
  const [result, setResult] = useState<PasswordResult>(IDLE);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) {
      return;
    }
    const formElement = e.currentTarget;
    const fields = validateFields(new FormData(formElement));
    if (typeof fields === "string") {
      setResult({ kind: "error", message: fields });
      return;
    }
    sending.current = true;
    setPending(true);
    setResult(IDLE);
    const outcome = await submitChange(email, fields);
    formElement.reset();
    setResult(outcome);
    setPending(false);
    sending.current = false;
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="contrasena-titulo"
      aria-describedby={describedBy(result)}
      aria-busy={pending}
      className="grid gap-4"
    >
      <PasswordField id="current_password" label="Contraseña actual" autoComplete="current-password" />
      <PasswordField id="new_password" label="Nueva contraseña" autoComplete="new-password" describedById={HELP_ID} />
      <p id={HELP_ID} className="text-ink-muted">
        Entre 8 y 100 caracteres
      </p>
      <PasswordField id="confirm_password" label="Confirmar nueva contraseña" autoComplete="new-password" />
      <ResultMessage result={result} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70"
      >
        Cambiar contraseña
      </button>
    </form>
  );
}
