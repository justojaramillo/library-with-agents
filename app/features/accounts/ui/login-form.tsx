"use client";

import { FirebaseError } from "firebase/app";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
// Primero `auth-client`: fija Zod sin compilación antes de crear los esquemas (CSP).
import { closeClientSession, loginWithIdToken, readErrorMessage, signInAndGetIdToken } from "./auth-client";
import { LoginInputSchema } from "../schema";

const DEFAULT_ERROR = "No se pudo ingresar";
const CREDENTIALS_ERROR = "Credenciales inválidas";
const TOO_MANY_MESSAGE = "Demasiados intentos. Espera unos minutos o recupera tu contraseña.";
const TOO_MANY_CODE = "auth/too-many-requests";
const ERROR_ID = "login-error";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";
const LINK_CLASS = "inline-flex min-h-11 items-center font-medium text-primary hover:text-primary-hover";
/** Enlace dentro de una frase: se subraya para no depender solo del color (WCAG 1.4.1). */
const INLINE_LINK_CLASS = `${LINK_CLASS} underline underline-offset-4`;

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

/** Fallo de ingreso: el texto y si se ofrece el enlace para recuperar la contraseña. */
export interface LoginFailure {
  message: string;
  offerRecovery: boolean;
}

/** Fallo para un error capturado; el `catch` lo pasa tal cual, sin anotarle tipo. */
export function failureForError<T>(error: T): LoginFailure {
  if (!(error instanceof FirebaseError)) {
    return { message: DEFAULT_ERROR, offerRecovery: false };
  }
  if (error.code === TOO_MANY_CODE) {
    return { message: TOO_MANY_MESSAGE, offerRecovery: true };
  }
  if (CREDENTIAL_ERROR_CODES.includes(error.code)) {
    return { message: CREDENTIALS_ERROR, offerRecovery: false };
  }
  return { message: DEFAULT_ERROR, offerRecovery: false };
}

/** Devuelve el fallo del intento de ingreso, o `null` si salió bien. */
async function attemptLogin(form: FormData): Promise<LoginFailure | null> {
  const input = LoginInputSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) {
    return { message: CREDENTIALS_ERROR, offerRecovery: false };
  }
  try {
    const idToken = await signInAndGetIdToken(input.data.email, input.data.password);
    const res = await loginWithIdToken(idToken);
    if (res.ok) {
      return null;
    }
    return { message: await readErrorMessage(res, DEFAULT_ERROR), offerRecovery: false };
  } catch (caught) {
    return failureForError(caught);
  } finally {
    await closeClientSession();
  }
}

/** Enlaza el formulario con el mensaje de error solo cuando existe. */
function describedBy(failure: LoginFailure | null): string | undefined {
  if (failure === null) {
    return undefined;
  }
  return ERROR_ID;
}

function RecoveryLink({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }
  return (
    <>
      {" "}
      <Link href="/recuperar" className={INLINE_LINK_CLASS}>
        Recuperar contraseña
      </Link>
    </>
  );
}

function ErrorMessage({ failure }: { failure: LoginFailure | null }) {
  if (failure === null) {
    return null;
  }
  return (
    <p id={ERROR_ID} role="alert" className="font-medium text-danger">
      {failure.message}
      <RecoveryLink show={failure.offerRecovery} />
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [failure, setFailure] = useState<LoginFailure | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const result = await attemptLogin(new FormData(e.currentTarget));
    if (result !== null) {
      setFailure(result);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="login-titulo"
      aria-describedby={describedBy(failure)}
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
      <ErrorMessage failure={failure} />
      <button
        type="submit"
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover"
      >
        Entrar
      </button>
      <ul className="flex flex-wrap gap-x-4">
        <li>
          <Link href="/recuperar" className={LINK_CLASS}>
            ¿Olvidaste tu contraseña?
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
