import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireUser } from "@/shared/server/http";

/**
 * Cuerpo tal como llega. La validación estricta (`CreateStaffInputSchema`) la hace el servicio tras comprobar el rol,
 * para que un bibliotecario reciba 403 aunque el cuerpo sea inválido. Un campo que no es texto, un cuerpo vacío o que
 * no es JSON se convierten en valores vacíos, que el servicio rechaza con 400. Los campos extra (`role`) se ignoran.
 */
const EMPTY_BODY = { name: "", email: "", password: "" };
const RawStaffBodySchema = z
  .object({ name: z.string().catch(""), email: z.string().catch(""), password: z.string().catch("") })
  .catch(EMPTY_BODY);

async function readRawBody(req: NextRequest): Promise<z.infer<typeof RawStaffBodySchema>> {
  const text = await req.text();
  try {
    return RawStaffBodySchema.parse(JSON.parse(text));
  } catch {
    return EMPTY_BODY;
  }
}

/** F13 · POST /api/staff — solo ADMINISTRADOR. Crea un BIBLIOTECARIO activo (el rol no viene en el cuerpo). 201. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    const input = await readRawBody(req);
    return NextResponse.json(await getContainer().staff.create(actor, input), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

/** F13 · GET /api/staff — solo ADMINISTRADOR. Bibliotecarios y administrador (hasta 200) por nombre y luego id. */
export async function GET() {
  try {
    const actor = await requireUser();
    return NextResponse.json(await getContainer().staff.list(actor));
  } catch (error) {
    return handleError(error);
  }
}
