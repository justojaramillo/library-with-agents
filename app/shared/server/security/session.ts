import type { Role, SessionUser } from "@/shared/schema";

/**
 * Nombre de la cookie de sesión de Firebase. En producción lleva el prefijo `__Host-`, que obliga al navegador
 * a exigir `Secure`, `path=/` y ningún `Domain`. En desarrollo (http) se usa `session`.
 */
export function sessionCookieName(): string {
  if (process.env.NODE_ENV === "production") {
    return "__Host-session";
  }
  return "session";
}

/** Atributos de la cookie de sesión (`HttpOnly`, `SameSite=Lax`, `Secure` en producción, `path=/`). */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Vigencia de la sesión: 8 horas. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionResolverDeps = {
  /** `{ uid }` si la cookie es válida (firma, vigencia, no revocada); `null` si no. */
  verifySessionCookie(cookie: string): Promise<{ uid: string } | null>;
  /** Rol y estado vigentes de la cuenta (`members/{uid}`), o `undefined` si no existe. */
  loadMember(uid: string): Promise<{ role: Role; active: boolean } | undefined>;
};

/**
 * Convierte la cookie de sesión en la identidad de la petición. Función pura: no conoce Firebase.
 * El rol sale siempre de la cuenta guardada, nunca de la cookie ni del cliente. Devuelve `null` si la cookie
 * falta o no es válida, o si la cuenta no existe o está inactiva.
 */
export function createSessionResolver(deps: SessionResolverDeps) {
  return async (cookie: string | undefined): Promise<SessionUser | null> => {
    if (!cookie) {
      return null;
    }
    const verified = await deps.verifySessionCookie(cookie);
    if (!verified) {
      return null;
    }
    const member = await deps.loadMember(verified.uid);
    if (!member || !member.active) {
      return null;
    }
    return { member_id: verified.uid, role: member.role };
  };
}
