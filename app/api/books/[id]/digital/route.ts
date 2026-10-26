import { NextResponse } from "next/server";
import { getContainer } from "@/features/container";
import { handleError, requireStaff } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/** F27 · GET /api/books/:id/digital — personal. `DigitalInfo` del libro; nunca el texto ni la ruta del archivo. */
export async function GET(_req: Request, context: Context) {
  try {
    const actor = await requireStaff();
    const { id } = await context.params;
    const info = await getContainer().digital.info(actor, id);
    return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
