import { FirebaseError } from "firebase/app";
import { sendEmailVerification, signInWithEmailAndPassword, signOut, updatePassword } from "firebase/auth";
// Primero: fija Zod sin compilación antes de que `@/shared/schema` cree sus esquemas (CSP).
import "@/shared/ui/client-setup";
import { ApiErrorSchema } from "@/shared/schema";
import { getClientAuth } from "@/shared/ui/firebase-client";
import type { SessionLoginInput } from "../schema";

/** Ingresa con Firebase en el navegador y devuelve el ID token para el servidor. */
export async function signInAndGetIdToken(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(getClientAuth(), email, password);
  return credential.user.getIdToken();
}

/** Cierra la sesión del SDK de cliente: la sesión real es la cookie del servidor. */
export async function closeClientSession(): Promise<void> {
  try {
    await signOut(getClientAuth());
  } catch {
    // Nada que cerrar o fallo local: no afecta a la cookie del servidor.
  }
}

/**
 * F11 · Envía el correo de verificación a la cuenta que ya tiene sesión en el SDK de cliente
 * (justo después de registrarse, antes de cerrarla). Puede fallar: quien llama decide qué hacer.
 */
export async function sendVerificationToSignedInUser(): Promise<void> {
  const user = getClientAuth().currentUser;
  if (user === null) {
    return;
  }
  await sendEmailVerification(user);
}

/**
 * F11 · Reenvío: inicia sesión con el SDK, envía el correo de verificación y cierra la sesión del SDK.
 * Los errores de Firebase (`auth/wrong-password`, `auth/too-many-requests`…) suben a quien llama.
 */
export async function sendVerificationEmail(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(getClientAuth(), email, password);
    await sendVerificationToSignedInUser();
  } finally {
    await closeClientSession();
  }
}

/** Mensaje de un cuerpo de error (también el 429 del servidor): se valida con el contrato en el mismo punto. */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    // El cuerpo no era JSON: se usa el mensaje por defecto.
  }
  return fallback;
}

/** Pide al servidor que cree la cookie de sesión a partir del ID token. */
export function loginWithIdToken(idToken: string): Promise<Response> {
  const body: SessionLoginInput = { id_token: idToken };
  return fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** F15 · La contraseña ya cambió, pero no se pudo emitir la cookie nueva: hay que ingresar de nuevo con la nueva. */
export class SessionRenewalError extends Error {
  constructor() {
    super("La contraseña se cambió, pero no se pudo renovar la sesión.");
    this.name = "SessionRenewalError";
  }
}

/** `true` si Firebase pide ingresar de nuevo antes de cambiar la contraseña. */
function isRecentLoginError<T>(error: T): boolean {
  return error instanceof FirebaseError && error.code === "auth/requires-recent-login";
}

/** Reautentica con la contraseña actual y la cambia; si Firebase pide ingreso reciente, repite una vez. */
async function reauthenticateAndUpdate(email: string, current: string, next: string): Promise<void> {
  const first = await signInWithEmailAndPassword(getClientAuth(), email, current);
  try {
    await updatePassword(first.user, next);
    return;
  } catch (caught) {
    if (!isRecentLoginError(caught)) {
      throw caught;
    }
  }
  const second = await signInWithEmailAndPassword(getClientAuth(), email, current);
  await updatePassword(second.user, next);
}

/**
 * Pide una cookie nueva con el ID token de un inicio de sesión posterior al cambio (con la contraseña nueva).
 * Cualquier fallo (Firebase, red o respuesta no `ok`) lanza `SessionRenewalError`: la contraseña ya cambió.
 */
async function renewServerSession(email: string, next: string): Promise<void> {
  try {
    const idToken = await signInAndGetIdToken(email, next);
    const res = await loginWithIdToken(idToken);
    if (res.ok) {
      return;
    }
  } catch {
    // Firebase o la red fallaron: se informa con el error propio de abajo.
  }
  throw new SessionRenewalError();
}

/**
 * F15 · Cambia la contraseña de la cuenta: reautentica con la actual, aplica la nueva, renueva la cookie con un nuevo inicio de sesión
 * (las anteriores dejan de valer) y cierra la sesión del SDK. Los errores de Firebase suben a quien llama;
 * `SessionRenewalError` indica que la contraseña sí cambió pero la cookie nueva no se pudo emitir.
 */
export async function changePassword(email: string, current: string, next: string): Promise<void> {
  try {
    await reauthenticateAndUpdate(email, current, next);
    await renewServerSession(email, next);
  } finally {
    await closeClientSession();
  }
}
