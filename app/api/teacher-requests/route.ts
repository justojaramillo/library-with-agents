import { NextResponse, type NextRequest } from "next/server";
import { ListTeacherRequestsQuerySchema } from "@/features/accounts/schema";
import { getContainer } from "@/features/container";
import { handleError, requireStaff } from "@/shared/server/http";

/** F12 · GET /api/teacher-requests?status=&limit=&after= — solo personal. Más antigua primero; `after` inexistente da 400. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff();
    const params = req.nextUrl.searchParams;
    const query = ListTeacherRequestsQuerySchema.parse({
      status: params.get("status") ?? undefined,
      limit: params.get("limit") ?? undefined,
      after: params.get("after") ?? undefined,
    });
    return NextResponse.json(await getContainer().teacherRequests.list(actor, query));
  } catch (error) {
    return handleError(error);
  }
}
