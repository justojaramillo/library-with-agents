import { NextResponse } from "next/server";
import { getContainer } from "@/features/container";
import { getSessionUser, handleError } from "@/shared/server/http";

/** GET /api/auth/me — la cuenta de la sesión actual; 401 con `null` si no hay sesión. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(null, { status: 401 });
    }
    return NextResponse.json((await getContainer().members.get(user.member_id)) ?? null);
  } catch (error) {
    return handleError(error);
  }
}
