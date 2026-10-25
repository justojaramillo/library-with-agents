import { NextResponse, type NextRequest } from "next/server";
import { LendInputSchema } from "@/features/loans/schema";
import { getContainer } from "@/features/container";
import { assertSameOrigin, handleError, requireUser } from "@/shared/server/http";

/**
 * F5 · POST /api/loans — personal a cualquier prestatario, o el prestatario a sí mismo.
 * El actor sale de la sesión; los campos extra del cuerpo se ignoran.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const actor = await requireUser();
    const input = LendInputSchema.parse(await req.json());
    const loan = await getContainer().loans.lend(input, actor, new Date());
    return NextResponse.json(loan, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
