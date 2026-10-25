import { NextResponse, type NextRequest } from "next/server";
import { getContainer, invalidateBooksCache } from "@/features/container";
import { CreateBookInputSchema, SearchBooksQuerySchema } from "@/features/catalog/schema";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";
import { clientKey, enforceRateLimit } from "@/shared/server/security/rate-limit";

/** F2 · GET /api/books?q=texto&limit=n — público. `limit` (1–50) es opcional. */
export async function GET(req: NextRequest) {
  try {
    enforceRateLimit("catalogSearch", clientKey(req), new Date());
    const params = req.nextUrl.searchParams;
    const { q, limit } = SearchBooksQuerySchema.parse({
      q: params.get("q") ?? "",
      limit: params.get("limit") ?? undefined,
    });
    return NextResponse.json(await getContainer().books.search(q, limit));
  } catch (error) {
    return handleError(error);
  }
}

/** F1 · POST /api/books — solo personal (bibliotecario o administrador). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireStaff();
    const input = CreateBookInputSchema.parse(await req.json());
    const book = await getContainer().books.create(input);
    invalidateBooksCache();
    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
