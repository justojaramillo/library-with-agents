import { NextResponse, type NextRequest } from "next/server";
import { IdSchema } from "@/shared/schema";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/** F12 · POST /api/teacher-requests/:id/approve — solo personal. Sin cuerpo. `:id` = `member_id` de la solicitud. */
export async function POST(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireStaff();
    const { id } = await context.params;
    const approved = await getContainer().teacherRequests.approve(actor, IdSchema.parse(id), new Date());
    return NextResponse.json(approved);
  } catch (error) {
    return handleError(error);
  }
}
