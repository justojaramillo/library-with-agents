"use client";

import { FirebaseError } from "firebase/app";
import { useId, useRef, useState } from "react";
import { sendVerificationEmail } from "./auth-client";

const DEFAULT_ERROR = "No se pudo enviar el correo. Inténtalo de nuevo.";
const TOO_MANY_MESSAGE = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
const WRONG_PASSWORD_MESSAGE = "Contraseña incorrecta.";
const SENT_MESSAGE =
  "Te enviamos un correo para verificar tu dirección. Cuando pulses el enlace, vuelve a esta página.";

/** Códigos de Firebase que significan «contraseña incorrecta» (mismo mensaje para todos). */
const WRONG_PASSWORD_CODES: readonly string[] = [
  "auth/wrong-password",
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/missing-password",
];

/** Mensaje para un error del reenvío (regla 4 de F11). El `catch` lo pasa tal cual, sin anotarle tipo. */
export function messageForVerificationError<T>(error: T): string {
  if (!(error instanceof FirebaseError)) {
    return DEFAULT_ERROR;
  }
  if (error.code === "auth/too-many-requests") {
    return TOO_MANY_MESSAGE;
  }
  if (WRONG_PASSWORD_CODES.includes(error.code)) {
    return WRONG_PASSWORD_MESSAGE;
  }
  return DEFAULT_ERROR;
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
        {SENT_MESSAGE}
      </p>
    );
  }
  return null;
}

/** Enlaza el campo con el mensaje solo cuando existe. */
function describedBy(messageId: string, visible: boolean): string | undefined {
  if (visible) {
    return messageId;
  }
  return undefined;
}

/**
 * F11 · Reenvío del correo de verificación. Pide la contraseña porque el navegador ya no tiene sesión de Firebase
 * (regla 4). El correo viene de la sesión del servidor, no de un campo.
 */
export function VerifyEmailForm({ email }: { email: string }) {
  const passwordId = useId();
  const messageId = useId();
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) {
      return;
    }
    const password = new FormData(e.currentTarget).get("password");
    if (typeof password !== "string" || password === "") {
      setError(WRONG_PASSWORD_MESSAGE);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setSent(false);
    try {
      await sendVerificationEmail(email, password);
      setSent(true);
    } catch (caught) {
      setError(messageForVerificationError(caught));
    }
    busy.current = false;
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Reenviar correo de verificación" className="grid gap-4">
      <div className="grid gap-1">
        <label htmlFor={passwordId} className="font-medium">
          Contraseña
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-describedby={describedBy(messageId, error !== null || sent)}
          aria-invalid={error !== null}
          className="min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink"
        />
      </div>
      <Feedback error={error} sent={sent} id={messageId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70 md:w-auto md:justify-self-start"
      >
        Enviar correo de verificación
      </button>
    </form>
  );
}
