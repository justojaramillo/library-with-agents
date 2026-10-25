import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { CreateMemberInputSchema } from "@/features/accounts/schema";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

/** Listado de cuentas — solo personal. */
export async function GET() {
  try {
    await requireStaff();
    return NextResponse.json(await getContainer().members.list());
  } catch (error) {
    return handleError(error);
  }
}

/**
 * F3 · POST /api/members — solo personal. Valida con `CreateMemberInputSchema`, que solo admite
 * roles seleccionables (EXTERNO | ESTUDIANTE): un rol de personal o DOCENTE da 400.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireStaff();
    const input = CreateMemberInputSchema.parse(await req.json());
    return NextResponse.json(await getContainer().members.register(input), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
