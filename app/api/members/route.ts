import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { CreateMemberInputSchema, ListMembersQuerySchema, SearchMembersQuerySchema } from "@/features/accounts/schema";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";
import { enforceRateLimit } from "@/shared/server/security/rate-limit";

/**
 * Solo personal. Con `q` busca personas (F34, B1–B5: `?q=&limit=&lendable=`; `q` inválido da 400; límite de tasa
 * por miembro del personal; la cabecera `X-Search-Truncated: 1` avisa de que puede haber más coincidencias).
 * Sin `q` devuelve una página de cuentas (`?limit=&after=`, S1).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff();
    const params = req.nextUrl.searchParams;
    if (params.has("q")) {
      enforceRateLimit("memberSearch", actor.member_id, new Date());
      const query = SearchMembersQuerySchema.parse({
        q: params.get("q") ?? undefined,
        limit: params.get("limit") ?? undefined,
        lendable: params.get("lendable") ?? undefined,
      });
      const found = await getContainer().members.search(query);
      if (found.truncated) {
        return NextResponse.json(found.members, { headers: { "X-Search-Truncated": "1" } });
      }
      return NextResponse.json(found.members);
    }
    const page = ListMembersQuerySchema.parse({
      limit: params.get("limit") ?? undefined,
      after: params.get("after") ?? undefined,
    });
    return NextResponse.json(await getContainer().members.list(page));
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
