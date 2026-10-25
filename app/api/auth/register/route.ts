import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { CreateMemberInputSchema } from "@/features/accounts/schema";
import { assertSameOrigin, handleError } from "@/shared/server/http";
import { clientKey, enforceRateLimit } from "@/shared/server/security/rate-limit";

/**
 * F10 · POST /api/auth/register — pública. Autorregistro de EXTERNO o ESTUDIANTE (cualquier otro rol da 400).
 * Límite de tasa por IP (10 por hora). No crea sesión ni lee la sesión: la pantalla ingresa después con el SDK.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    enforceRateLimit("register", clientKey(req), new Date());
    const input = CreateMemberInputSchema.parse(await req.json());
    return NextResponse.json(await getContainer().members.register(input), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
