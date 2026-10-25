import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { CreateMemberInputSchema, SearchMembersQuerySchema } from "@/features/accounts/schema";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

/**
 * Solo personal. Con `q` busca personas (F34, B1–B5: `?q=&limit=&lendable=`; `q` inválido da 400);
 * sin `q` lista todas las cuentas.
 */
export async function GET(req: NextRequest) {
  try {
    await requireStaff();
    const params = req.nextUrl.searchParams;
    if (params.has("q")) {
      const query = SearchMembersQuerySchema.parse({
        q: params.get("q") ?? undefined,
        limit: params.get("limit") ?? undefined,
        lendable: params.get("lendable") ?? undefined,
      });
      return NextResponse.json(await getContainer().members.search(query));
    }
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
