import { NextResponse, type NextRequest } from "next/server";
import { IdSchema } from "@/shared/schema";
import { getContainer } from "@/features/container";
import { handleError, requireUser } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/** F8 · GET /api/members/:id/overdue — el prestatario sus vencidos; el personal los de cualquiera. */
export async function GET(_req: NextRequest, context: Context) {
  try {
    const actor = await requireUser();
    const { id } = await context.params;
    const overdue = await getContainer().loans.listOverdue(IdSchema.parse(id), actor, new Date());
    return NextResponse.json(overdue);
  } catch (error) {
    return handleError(error);
  }
}
