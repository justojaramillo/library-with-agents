import type { Auth } from "firebase-admin/auth";
import { ConflictError } from "@/shared/server/errors";
import { describeAuthError, isExpectedAuthError } from "@/shared/server/security/firebase-errors";
import type { IdentityProvider } from "./identity";

/** Traduce `auth/email-already-exists` a `ConflictError`; cualquier otro error se relanza. */
function rethrowAsConflict<T>(error: T): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "auth/email-already-exists") {
      throw new ConflictError("Ya existe una cuenta con ese correo.");
    }
  }
  throw error;
}

/** Identidad real con Firebase Authentication (SDK de administración). */
export function createFirebaseIdentityProvider(auth: Auth): IdentityProvider {
  return {
    async createUser({ email, password, name }) {
      try {
        const user = await auth.createUser({ email, password, displayName: name });
        return { uid: user.uid };
      } catch (error) {
        return rethrowAsConflict(error);
      }
    },
    deleteUser: (uid) => auth.deleteUser(uid),
    async verifyIdToken(idToken) {
      try {
        const decoded = await auth.verifyIdToken(idToken, true);
        return { uid: decoded.uid };
      } catch (error) {
        // Token inválido, vencido o revocado → `null`; cualquier otro fallo es de infraestructura y se relanza.
        if (isExpectedAuthError(error)) {
          return null;
        }
        console.error("Fallo de infraestructura al verificar el ID token:", describeAuthError(error));
        throw error;
      }
    },
    createSessionCookie: (idToken, ttlSeconds) => auth.createSessionCookie(idToken, { expiresIn: ttlSeconds * 1000 }),
  };
}
