import { ConflictError, UnauthorizedError } from "@/shared/server/errors";
import type { IdentityProvider } from "./identity";

type StoredUser = { email: string; password: string; name: string };

/** Identidad en memoria para las pruebas, con los dos ayudantes que en producción hacen el SDK de cliente y el SDK de administración. */
export type MemoryIdentityProvider = IdentityProvider & {
  /** Simula el SDK de cliente: devuelve un `id_token` si el correo y la contraseña coinciden; si no, `null`. */
  signIn(email: string, password: string): Promise<string | null>;
  /** Simula `verifySessionCookie` del SDK de administración: `{ uid }` si la cookie la emitió este proveedor. */
  verifySessionCookie(cookie: string): Promise<{ uid: string } | null>;
};

class MemoryIdentity implements MemoryIdentityProvider {
  private readonly users = new Map<string, StoredUser>();
  private readonly idTokens = new Map<string, string>();
  private readonly cookies = new Map<string, string>();
  private counter = 0;

  async createUser({ email, password, name }: StoredUser) {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) {
        throw new ConflictError("Ese correo ya está registrado");
      }
    }
    this.counter += 1;
    const uid = `uid-${this.counter}`;
    this.users.set(uid, { email: normalized, password, name });
    return { uid };
  }

  async deleteUser(uid: string) {
    this.users.delete(uid);
  }

  async verifyIdToken(idToken: string) {
    const uid = this.idTokens.get(idToken);
    if (!uid || !this.users.has(uid)) {
      return null;
    }
    return { uid };
  }

  async createSessionCookie(idToken: string, ttlSeconds: number) {
    const verified = await this.verifyIdToken(idToken);
    if (!verified || ttlSeconds <= 0) {
      throw new UnauthorizedError("ID token inválido");
    }
    const cookie = `cookie-${this.cookies.size + 1}-${verified.uid}`;
    this.cookies.set(cookie, verified.uid);
    return cookie;
  }

  async signIn(email: string, password: string) {
    const normalized = email.toLowerCase();
    for (const [uid, user] of this.users) {
      if (user.email === normalized && user.password === password) {
        const token = `id-token-${this.idTokens.size + 1}-${uid}`;
        this.idTokens.set(token, uid);
        return token;
      }
    }
    return null;
  }

  async verifySessionCookie(cookie: string) {
    const uid = this.cookies.get(cookie);
    if (!uid || !this.users.has(uid)) {
      return null;
    }
    return { uid };
  }
}

export function createMemoryIdentityProvider(): MemoryIdentityProvider {
  return new MemoryIdentity();
}
