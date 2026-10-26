import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";
import { readBodyText } from "@/shared/server/security/body-limit";
import { enforceRateLimit } from "@/shared/server/security/rate-limit";

type Context = { params: Promise<{ id: string }> };

/**
 * Tope del cuerpo: los 2 000 000 de bytes del texto más el escapado de JSON (comillas, saltos de línea). Por debajo
 * del límite de 4,5 MB del cuerpo de una función de Vercel. El tope exacto del texto lo aplica el servicio.
 */
const MAX_BODY_BYTES = 4_200_000;

/**
 * Cuerpo tal como llega. `markdown` solo se conserva si es texto; si no (ausente, número, `null`, cuerpo vacío o que
 * no es JSON) queda `undefined` y el servicio responde 400 después de comprobar el rol y el `:id`.
 */
const RawContentBodySchema = z
  .object({ markdown: z.string().optional().catch(undefined) })
  .catch({ markdown: undefined });

async function readRawContent(req: NextRequest): Promise<z.infer<typeof RawContentBodySchema>> {
  const text = await readBodyText(req, MAX_BODY_BYTES);
  try {
    return RawContentBodySchema.parse(JSON.parse(text));
  } catch {
    return { markdown: undefined };
  }
}

/**
 * F27 · PUT /api/books/:id/digital/content — personal. Cuerpo `{ markdown }`. Límite de tasa por cuenta (20 por hora)
 * antes de leer el cuerpo. 200 con `DigitalInfo`; la respuesta nunca incluye el texto ni la ruta del archivo.
 */
export async function PUT(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireStaff();
    enforceRateLimit("contentUpload", actor.member_id, new Date());
    const { id } = await context.params;
    const input = await readRawContent(req);
    const info = await getContainer().digital.uploadContent(actor, id, input, new Date());
    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
