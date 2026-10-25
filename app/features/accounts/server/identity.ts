/**
 * Puerto de identidad: lo que la feature necesita de Firebase Authentication. La app nunca ve ni guarda una
 * contraseña salvo para entregarla a `createUser`. Implementaciones: `identity.firebase.ts` (real) e
 * `identity.memory.ts` (pruebas).
 */
export interface IdentityProvider {
  /** Crea la identidad (correo y contraseña). `ConflictError` si el correo ya existe. */
  createUser(input: { email: string; password: string; name: string }): Promise<{ uid: string }>;
  /** Borra la identidad (compensación si falla guardar la cuenta). */
  deleteUser(uid: string): Promise<void>;
  /** `{ uid }` si el ID token es válido; `null` si es inválido o expiró. */
  verifyIdToken(idToken: string): Promise<{ uid: string } | null>;
  /** Cambia un ID token reciente por una cookie de sesión con esa vigencia. */
  createSessionCookie(idToken: string, ttlSeconds: number): Promise<string>;
}
