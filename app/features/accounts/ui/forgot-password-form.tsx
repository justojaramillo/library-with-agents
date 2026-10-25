"use client";

import { FirebaseError } from "firebase/app";
import { sendPasswordResetEmail } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
// Primero: fija Zod sin compilación antes de que se creen los esquemas (CSP).
import "@/shared/ui/client-setup";
import { getClientAuth } from "@/shared/ui/firebase-client";
import { ForgotPasswordInputSchema } from "../schema";

const INVALID_EMAIL_MESSAGE = "Escribe un correo válido.";
const TOO_MANY_MESSAGE = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
const DEFAULT_ERROR = "No se pudo enviar el enlace. Inténtalo de nuevo.";
const SUCCESS_MESSAGE =
  "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de spam.";
const ERROR_ID = "recuperar-error";
const STATUS_ID = "recuperar-estado";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

/** Mensaje por código de Firebase; `auth/user-not-found` no está: se trata como éxito (regla 11). */
const RESET_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "auth/invalid-email": INVALID_EMAIL_MESSAGE,
  "auth/too-many-requests": TOO_MANY_MESSAGE,
};

/**
 * Mensaje para un error al enviar el enlace; `null` significa «tratar como éxito»
 * (el mismo mensaje exista o no la cuenta). El `catch` pasa el error tal cual.
 */
export function messageForResetError<T>(error: T): string | null {
  if (!(error instanceof FirebaseError)) {
    return DEFAULT_ERROR;
  }
  if (error.code === "auth/user-not-found") {
    return null;
  }
  return RESET_ERROR_MESSAGES[error.code] ?? DEFAULT_ERROR;
}

interface ResetOutcome {
  error: string | null;
  sent: boolean;
}

/** Valida el correo y pide a Firebase el envío del enlace. */
async function attemptReset(form: FormData): Promise<ResetOutcome> {
  const input = ForgotPasswordInputSchema.safeParse({ email: form.get("email") });
  if (!input.success) {
    return { error: INVALID_EMAIL_MESSAGE, sent: false };
  }
  try {
    await sendPasswordResetEmail(getClientAuth(), input.data.email);
    return { error: null, sent: true };
  } catch (caught) {
    const message = messageForResetError(caught);
    return { error: message, sent: message === null };
  }
}

/** Enlaza el formulario con el mensaje visible (error o estado) solo cuando existe. */
function describedBy(error: string | null, sent: boolean): string | undefined {
  if (error !== null) {
    return ERROR_ID;
  }
  if (sent) {
    return STATUS_ID;
  }
  return undefined;
}

interface FeedbackProps {
  error: string | null;
  sent: boolean;
}

function Feedback({ error, sent }: FeedbackProps) {
  if (error !== null) {
    return (
      <p id={ERROR_ID} role="alert" className="font-medium text-danger">
        {error}
      </p>
    );
  }
  if (sent) {
    return (
      <p id={STATUS_ID} role="status" className="font-medium text-success">
        {SUCCESS_MESSAGE}
      </p>
    );
  }
  return null;
}

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    setSent(false);
    const outcome = await attemptReset(new FormData(e.currentTarget));
    setError(outcome.error);
    setSent(outcome.sent);
    setPending(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="recuperar-titulo"
      aria-describedby={describedBy(error, sent)}
      className="grid gap-4"
    >
      <div className="grid gap-1">
        <label htmlFor="email" className="font-medium">
          Correo
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={INPUT_CLASS} />
      </div>
      <Feedback error={error} sent={sent} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70"
      >
        Enviar enlace
      </button>
      <ul className="flex flex-wrap gap-x-4">
        <li>
          <Link href="/login" className={LINK_CLASS}>
            Volver a ingresar
          </Link>
        </li>
        <li>
          <Link href="/registro" className={LINK_CLASS}>
            Crear cuenta
          </Link>
        </li>
      </ul>
    </form>
  );
}
