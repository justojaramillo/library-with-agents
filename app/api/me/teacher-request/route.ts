import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireUser } from "@/shared/server/http";
import { enforceRateLimit } from "@/shared/server/security/rate-limit";

/**
 * Cuerpo tal como llega. La validación de `note` (10–500) la hace el servicio en el último paso de la regla 7,
 * para que un rol o un correo no válidos den 409/403 antes que un 400. Los campos extra (`member_id`, `status`…) se ignoran.
 */
const RawTeacherRequestBodySchema = z.object({ note: z.string().optional() });

/**
 * F11 · POST /api/me/teacher-request — EXTERNO o ESTUDIANTE con correo verificado. La identidad sale de la sesión.
 * Límite de tasa por cuenta (5 por hora) antes de leer el cuerpo. 201 con la solicitud.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    enforceRateLimit("teacherRequest", actor.member_id, new Date());
    const body = RawTeacherRequestBodySchema.parse(await req.json());
    const created = await getContainer().teacherRequests.request(actor, body, new Date());
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

/** F11 · GET /api/me/teacher-request — `{ request, email_verified }` de la sesión (el personal recibe `request: null`). */
export async function GET() {
  try {
    const actor = await requireUser();
    return NextResponse.json(await getContainer().teacherRequests.getMine(actor));
  } catch (error) {
    return handleError(error);
  }
}
