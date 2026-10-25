import { NextResponse, type NextRequest } from "next/server";
import { IdSchema } from "@/shared/schema";
import { RejectTeacherRequestInputSchema } from "@/features/accounts/schema";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

type Context = { params: Promise<{ id: string }> };

/**
 * F12 · POST /api/teacher-requests/:id/reject — solo personal. Cuerpo opcional `{ reason? }`: sin cuerpo equivale a
 * sin motivo; un cuerpo que no es JSON da 400.
 */
export async function POST(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const actor = await requireStaff();
    const { id } = await context.params;
    const memberId = IdSchema.parse(id);
    const text = await req.text();
    let input = RejectTeacherRequestInputSchema.parse({});
    if (text.trim() !== "") {
      input = RejectTeacherRequestInputSchema.parse(JSON.parse(text));
    }
    const rejected = await getContainer().teacherRequests.reject(actor, memberId, input, new Date());
    return NextResponse.json(rejected);
  } catch (error) {
    return handleError(error);
  }
}
