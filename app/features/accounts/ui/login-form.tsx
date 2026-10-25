"use client";

import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiErrorSchema } from "@/shared/schema";
import { getClientAuth } from "@/shared/ui/firebase-client";
import { LoginInputSchema, type SessionLoginInput } from "../schema";

const DEFAULT_ERROR = "No se pudo ingresar";
const CREDENTIALS_ERROR = "Credenciales inválidas";
const ERROR_ID = "login-error";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";

/** Códigos de Firebase que significan «credenciales inválidas»: todos muestran el mismo mensaje (regla 4). */
const CREDENTIAL_ERROR_CODES: readonly string[] = [
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-email",
  "auth/user-disabled",
  "auth/missing-password",
];

/** Mensaje para un error capturado; el `catch` lo pasa tal cual, sin anotarle tipo. */
function messageForError<T>(error: T): string {
  if (error instanceof FirebaseError && CREDENTIAL_ERROR_CODES.includes(error.code)) {
    return CREDENTIALS_ERROR;
  }
  return DEFAULT_ERROR;
}

/** Mensaje de un cuerpo de error: se valida con el contrato en el mismo punto de lectura. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    // El cuerpo no era JSON: se usa el mensaje por defecto.
  }
  return DEFAULT_ERROR;
}

/** Cierra la sesión del SDK de cliente: la sesión real es la cookie del servidor. */
async function closeClientSession(): Promise<void> {
  try {
    await signOut(getClientAuth());
  } catch {
    // Nada que cerrar o fallo local: no afecta a la cookie del servidor.
  }
}

/** Ingresa con Firebase en el navegador y devuelve el ID token para el servidor. */
async function getIdTokenFor(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(getClientAuth(), email, password);
  return credential.user.getIdToken();
}

/** Pide al servidor que cree la cookie de sesión a partir del ID token. */
function postSessionLogin(idToken: string): Promise<Response> {
  const body: SessionLoginInput = { id_token: idToken };
  return fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Devuelve el mensaje de error del intento de ingreso, o `null` si salió bien. */
async function attemptLogin(form: FormData): Promise<string | null> {
  const input = LoginInputSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) {
    return CREDENTIALS_ERROR;
  }
  try {
    const idToken = await getIdTokenFor(input.data.email, input.data.password);
    const res = await postSessionLogin(idToken);
    if (res.ok) {
      return null;
    }
    return await readErrorMessage(res);
  } catch (caught) {
    return messageForError(caught);
  } finally {
    await closeClientSession();
  }
}

/** Enlaza el formulario con el mensaje de error solo cuando existe. */
function describedBy(error: string | null): string | undefined {
  if (error === null) {
    return undefined;
  }
  return ERROR_ID;
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const message = await attemptLogin(new FormData(e.currentTarget));
    if (message !== null) {
      setError(message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="login-titulo"
      aria-describedby={describedBy(error)}
      className="grid gap-4"
    >
      <div className="grid gap-1">
        <label htmlFor="email" className="font-medium">
          Correo
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={INPUT_CLASS} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="password" className="font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={INPUT_CLASS}
        />
      </div>
      {error !== null && (
        <p id={ERROR_ID} role="alert" className="font-medium text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover"
      >
        Entrar
      </button>
    </form>
  );
}
