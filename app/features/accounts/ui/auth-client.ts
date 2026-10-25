import { signInWithEmailAndPassword, signOut } from "firebase/auth";
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
