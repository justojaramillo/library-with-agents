import { NextResponse, type NextRequest } from "next/server";
import { IdSchema } from "@/shared/schema";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireUser } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/** F6 · POST /api/loans/:id/return — solo personal (lo decide el servicio). Sin cuerpo. */
export async function POST(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    const { id } = await context.params;
    const result = await getContainer().loans.returnLoan(IdSchema.parse(id), actor, new Date());
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
