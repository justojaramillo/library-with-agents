import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, handleError, revokeSessionCookie } from "@/shared/server/http";
import { sessionCookieName, sessionCookieOptions } from "@/shared/server/security/session";

/**
 * POST /api/auth/logout — revoca los tokens de la cuenta (si la cookie es válida) y siempre borra la cookie.
 * Un fallo al verificar o revocar no impide cerrar sesión.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await revokeSessionCookie(req.cookies.get(sessionCookieName())?.value);
    const res = NextResponse.json({ ok: true });
    // `set` con los mismos atributos (y `Secure` en producción): el prefijo `__Host-` lo exige también al borrar.
    res.cookies.set(sessionCookieName(), "", sessionCookieOptions(0));
    return res;
  } catch (error) {
    return handleError(error);
  }
}
