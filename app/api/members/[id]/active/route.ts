import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Cuerpo tal como llega. `active` solo se conserva si es booleano; si no (ausente, `null`, cadena, cuerpo vacío o que
 * no es JSON) queda `undefined` y el servicio responde 400 después de comprobar el rol y el `:id`.
 */
const RawActiveBodySchema = z.object({ active: z.boolean().optional().catch(undefined) }).catch({ active: undefined });

async function readRawActive(req: NextRequest): Promise<boolean | undefined> {
  const text = await req.text();
  try {
    return RawActiveBodySchema.parse(JSON.parse(text)).active;
  } catch {
    return undefined;
  }
}

/** F14 · PATCH /api/members/:id/active — personal, según la matriz de la regla 7. Cuerpo `{ active: boolean }`. */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireStaff();
    const { id } = await context.params;
    const active = await readRawActive(req);
    return NextResponse.json(await getContainer().staff.setActive(actor, id, active));
  } catch (error) {
    return handleError(error);
  }
}
