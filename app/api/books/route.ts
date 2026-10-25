import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/features/container";
import { CreateBookInputSchema, SearchBooksQuerySchema } from "@/features/catalog/schema";
import { assertSameOrigin, handleError, requireStaff } from "@/shared/server/http";

/** F2 · GET /api/books?q=texto — público. */
export async function GET(req: NextRequest) {
  try {
    const { q } = SearchBooksQuerySchema.parse({ q: req.nextUrl.searchParams.get("q") ?? "" });
    return NextResponse.json(await getContainer().books.search(q));
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
    return NextResponse.json(await getContainer().books.create(input), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
