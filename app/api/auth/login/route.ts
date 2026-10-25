import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { SessionLoginInputSchema } from "@/features/accounts/schema";
import { assertSameOrigin, handleError } from "@/shared/server/http";
import { clientKey, enforceRateLimit } from "@/shared/server/security/rate-limit";
import { SESSION_TTL_SECONDS, sessionCookieName, sessionCookieOptions } from "@/shared/server/security/session";

/**
 * F4 · POST /api/auth/login — recibe el ID token de Firebase (la persona ya ingresó en el navegador con
 * correo y contraseña), crea la cookie de sesión y devuelve la cuenta.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    enforceRateLimit("login", clientKey(req), new Date());
    const input = SessionLoginInputSchema.parse(await req.json());
    const { member, sessionCookie } = await getContainer().auth.login(input);
    const res = NextResponse.json(member);
    res.cookies.set(sessionCookieName(), sessionCookie, sessionCookieOptions(SESSION_TTL_SECONDS));
    return res;
  } catch (error) {
    return handleError(error);
  }
}
