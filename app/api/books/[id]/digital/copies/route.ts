import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";
import { readBodyText } from "@/shared/server/security/body-limit";

type Context = { params: Promise<{ id: string }> };

/** Un cuerpo de copias es diminuto; cualquier cosa mayor se rechaza sin procesarla. */
const MAX_BODY_BYTES = 1024;

/**
 * Cuerpo tal como llega. `digital_copies` solo se conserva si es un número; si no (ausente, `null`, texto, cuerpo
 * vacío o que no es JSON) queda `undefined` y el servicio responde 400 después de comprobar el rol y el `:id`.
 * Los decimales y los valores fuera de 0–100 los rechaza el servicio con el esquema del contrato.
 */
const RawCopiesBodySchema = z
  .object({ digital_copies: z.number().optional().catch(undefined) })
  .catch({ digital_copies: undefined });

async function readRawCopies(req: NextRequest): Promise<z.infer<typeof RawCopiesBodySchema>> {
  const text = await readBodyText(req, MAX_BODY_BYTES);
  try {
    return RawCopiesBodySchema.parse(JSON.parse(text));
  } catch {
    return { digital_copies: undefined };
  }
}

/** F27 · PATCH /api/books/:id/digital/copies — personal. Cuerpo `{ digital_copies: 0–100 }`. 200 con `DigitalInfo`. */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireStaff();
    const { id } = await context.params;
    const input = await readRawCopies(req);
    const info = await getContainer().digital.setCopies(actor, id, input);
    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
