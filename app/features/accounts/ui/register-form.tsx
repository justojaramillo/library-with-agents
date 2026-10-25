"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
// Primero: fija Zod sin compilación antes de que `../schema` cree sus esquemas (CSP).
import "@/shared/ui/client-setup";
import { type CreateMemberInput, CreateMemberInputSchema } from "../schema";
import {
  closeClientSession,
  loginWithIdToken,
  readErrorMessage,
  sendVerificationToSignedInUser,
  signInAndGetIdToken,
} from "./auth-client";

const DEFAULT_ERROR = "No se pudo crear la cuenta";
const INVALID_DATA_ERROR = "Revisa los datos: nombre, un correo válido y una contraseña de 8 a 100 caracteres.";
const MISMATCH_ERROR = "Las contraseñas no coinciden.";
const RATE_LIMIT_ERROR = "Demasiados registros desde tu conexión. Inténtalo más tarde.";
const CREATED_NOTICE = "Tu cuenta se creó. Ingresa con tu correo y contraseña.";
const ERROR_ID = "registro-error";
const HINT_ID = "registro-ayuda";
const INPUT_CLASS = "min-h-11 w-full rounded border border-control-border bg-surface px-3 text-ink";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

/** Resultado del intento: éxito, mensaje de error, o cuenta creada pero sin ingreso automático. */
type Outcome = { kind: "ok" } | { kind: "error"; message: string } | { kind: "created" };

const OK: Outcome = { kind: "ok" };
const CREATED: Outcome = { kind: "created" };

function failure(message: string): Outcome {
  return { kind: "error", message };
}

/** Mensaje de un registro rechazado: el 429 tiene texto propio; el resto, el del servidor. */
async function rejectionFrom(res: Response): Promise<Outcome> {
  if (res.status === 429) {
    return failure(RATE_LIMIT_ERROR);
  }
  return failure(await readErrorMessage(res, DEFAULT_ERROR));
}

/** Regla 3 de F11: el correo de verificación es un extra; si no sale, el registro sigue y se podrá reenviar en /docente. */
async function trySendVerification(): Promise<void> {
  try {
    await sendVerificationToSignedInUser();
  } catch {
    // Se omite: el reenvío está en /docente.
  }
}

/** Ingresa tras el registro; si algo falla, la cuenta ya existe y solo falta ingresar a mano. */
async function signInAfterRegister(input: CreateMemberInput): Promise<Outcome> {
  try {
    const idToken = await signInAndGetIdToken(input.email, input.password);
    await trySendVerification();
    const res = await loginWithIdToken(idToken);
    if (res.ok) {
      return OK;
    }
    return CREATED;
  } catch {
    return CREATED;
  } finally {
    await closeClientSession();
  }
}

/** Envía el registro al servidor y, si sale bien, ingresa. */
async function submitRegistration(input: CreateMemberInput): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return failure(DEFAULT_ERROR);
  }
  if (!res.ok) {
    return rejectionFrom(res);
  }
  return signInAfterRegister(input);
}

/** Valida en el navegador (contraseñas iguales y contrato) y registra. */
async function attemptRegister(form: FormData): Promise<Outcome> {
  if (form.get("password") !== form.get("confirm_password")) {
    return failure(MISMATCH_ERROR);
  }
  const input = CreateMemberInputSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
    role: form.get("role"),
  });
  if (!input.success) {
    return failure(INVALID_DATA_ERROR);
  }
  return submitRegistration(input.data);
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

function RoleFieldset() {
  return (
    <fieldset className="grid gap-1">
      <legend className="font-medium">Soy</legend>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="role" value="EXTERNO" defaultChecked className="size-5 accent-primary" />
        Externo
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="radio" name="role" value="ESTUDIANTE" className="size-5 accent-primary" />
        Estudiante
      </label>
    </fieldset>
  );
}

/** Mensaje del intento (error o aviso de cuenta creada); nada si no hay. */
function RegisterMessage({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "error") {
    return (
      <p id={ERROR_ID} role="alert" className="font-medium text-danger">
        {outcome.message}
      </p>
    );
  }
  if (outcome.kind === "created") {
    return (
      <p id={ERROR_ID} role="alert" className="font-medium text-ink">
        {CREATED_NOTICE}{" "}
        <Link href="/login" className={LINK_CLASS}>
          Ir a ingresar
        </Link>
      </p>
    );
  }
  return null;
}

/** Enlaza el formulario con el mensaje solo cuando existe. */
function describedBy(outcome: Outcome): string | undefined {
  if (outcome.kind === "ok") {
    return undefined;
  }
  return ERROR_ID;
}

export function RegisterForm() {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>(OK);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setOutcome(OK);
    const result = await attemptRegister(new FormData(e.currentTarget));
    if (result.kind === "ok") {
      router.push("/");
      router.refresh();
      return;
    }
    setOutcome(result);
    setPending(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="registro-titulo"
      aria-describedby={describedBy(outcome)}
      className="grid gap-4"
    >
      <TextField id="name" name="name" label="Nombre" type="text" autoComplete="name" maxLength={120} />
      <TextField id="email" name="email" label="Correo" type="email" autoComplete="email" />
      <TextField
        id="password"
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
      <TextField
        id="confirm_password"
        name="confirm_password"
        label="Confirmar contraseña"
        type="password"
        autoComplete="new-password"
        maxLength={100}
      />
      <RoleFieldset />
      <RegisterMessage outcome={outcome} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-primary px-4 font-medium text-surface hover:bg-primary-hover disabled:opacity-70"
      >
        Crear cuenta
      </button>
      <p>
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className={LINK_CLASS}>
          Ingresar
        </Link>
      </p>
    </form>
  );
}
