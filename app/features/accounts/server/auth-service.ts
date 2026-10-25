import { UnauthorizedError } from "@/shared/server/errors";
import { SESSION_TTL_SECONDS } from "@/shared/server/security/session";
import { SessionLoginInputSchema, type Member, type SessionLoginInput } from "../schema";
import type { IdentityProvider } from "./identity";
import { toPublicMember } from "./member-service";
import type { MemberRepository } from "./repository";

export type AuthService = {
  /**
   * F4 · Cambia el ID token de Firebase por una cookie de sesión. Token inválido, cuenta inexistente o inactiva
   * dan el mismo error (`Credenciales inválidas`). Un fallo de infraestructura al crear la cookie NO se disfraza:
   * se propaga (500) para que una mala configuración de Firebase no parezca una contraseña errónea.
   */
  login(input: SessionLoginInput): Promise<{ member: Member; sessionCookie: string }>;
};

const invalidCredentials = () => new UnauthorizedError("Credenciales inválidas");

export function createAuthService(deps: { members: MemberRepository; identity: IdentityProvider }): AuthService {
  return {
    async login(input) {
      const { id_token: idToken } = SessionLoginInputSchema.parse(input);
      const verified = await deps.identity.verifyIdToken(idToken);
      if (!verified) {
        throw invalidCredentials();
      }
      const record = await deps.members.findById(verified.uid);
      if (!record || !record.active) {
        throw invalidCredentials();
      }
      const sessionCookie = await deps.identity.createSessionCookie(idToken, SESSION_TTL_SECONDS);
      return { member: toPublicMember(record), sessionCookie };
    },
  };
}
