import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { RoleSchema, STAFF_ROLES, type ApiError, type SessionUser } from "@/shared/schema";
import { COLLECTIONS } from "./collections";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { getAdminAuth, getAdminDb } from "./firebase";
import { describeAuthError, isExpectedAuthError } from "./security/firebase-errors";
import { checkSameOrigin } from "./security/origin";
import { createSessionResolver, sessionCookieName } from "./security/session";

/** Cada error de dominio con su código HTTP. Es la única tabla de traducción. */
const ERROR_STATUS: [new (message: string) => Error, number][] = [
  [UnauthorizedError, 401],
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [ConflictError, 409],
];

/** Traducción única de errores de dominio → HTTP. Las rutas no deciden códigos por su cuenta. */
export function handleError<T>(error: T): NextResponse<ApiError> {
  // Los errores internos de Next (prerender, redirect, notFound) no son nuestros: se vuelven a lanzar.
  unstable_rethrow(error);
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));
    return NextResponse.json({ error: "Datos inválidos", issues }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  for (const [errorClass, status] of ERROR_STATUS) {
    if (error instanceof errorClass) {
      return NextResponse.json({ error: error.message }, { status });
    }
  }
  console.error(error); // el detalle va al log, no al cliente
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

/** Lo único que se lee de `members/{uid}` para la sesión; los campos extra del documento se ignoran. */
const SessionMemberSchema = z.object({ role: RoleSchema, active: z.boolean() });

/**
 * Verifica la cookie de sesión de Firebase (con revocación). Una cookie inválida, expirada o revocada da `null`;
 * cualquier otro error es de infraestructura: se registra (solo el código) y se relanza.
 */
async function verifySessionCookie(cookie: string): Promise<{ uid: string } | null> {
  try {
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    return { uid: decoded.uid };
  } catch (error) {
    if (isExpectedAuthError(error)) {
      return null;
    }
    console.error("Fallo de infraestructura al verificar la sesión:", describeAuthError(error));
    throw error;
  }
}

/**
 * Cierra la sesión en el servidor: si la cookie es válida, revoca los tokens de refresco de la cuenta.
 * Nunca lanza: un fallo aquí no debe impedir que la persona cierre sesión (la ruta borra la cookie siempre).
 */
export async function revokeSessionCookie(cookie: string | undefined): Promise<void> {
  if (!cookie) {
    return;
  }
  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifySessionCookie(cookie);
    await auth.revokeRefreshTokens(decoded.uid);
  } catch (error) {
    if (!isExpectedAuthError(error)) {
      console.error("Fallo de infraestructura al revocar la sesión:", describeAuthError(error));
    }
  }
}

/** Contenido del cuerpo de la petición para la comprobación: `null` si no lleva cuerpo. */
function bodyContentType(req: Request): string | null {
  const contentType = req.headers.get("content-type");
  const length = req.headers.get("content-length");
  const hasBody = (length !== null && length !== "0") || req.headers.has("transfer-encoding");
  if (contentType !== null) {
    return contentType;
  }
  if (hasBody) {
    return "";
  }
  return null;
}

/**
 * Defensa CSRF de las rutas POST: solo mismo origen y, con cuerpo, `Content-Type: application/json`.
 * Lanza `ForbiddenError` (403). Se llama al inicio de cada POST, antes de leer el cuerpo.
 */
export function assertSameOrigin(req: Request): void {
  const allowed = checkSameOrigin({
    method: req.method,
    secFetchSite: req.headers.get("sec-fetch-site"),
    origin: req.headers.get("origin"),
    requestOrigin: new URL(req.url).origin,
    contentType: bodyContentType(req),
  });
  if (!allowed) {
    throw new ForbiddenError("Origen no permitido");
  }
}

/** Rol y estado actuales de la cuenta, validados con Zod (ADR-0003: el rol sale de Firestore). */
async function loadSessionMember(uid: string): Promise<z.infer<typeof SessionMemberSchema> | undefined> {
  const snapshot = await getAdminDb().collection(COLLECTIONS.members).doc(uid).get();
  if (!snapshot.exists) {
    return undefined;
  }
  return SessionMemberSchema.parse(snapshot.data());
}

/** Usuario de la sesión (cookie de sesión de Firebase) o `null`. Lee cookies: es una API de petición (va dentro de `<Suspense>`). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const resolve = createSessionResolver({ verifySessionCookie, loadMember: loadSessionMember });
  return resolve(store.get(sessionCookieName())?.value);
}

/** Exige sesión; lanza UnauthorizedError si no hay. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError("Inicia sesión");
  }
  return user;
}

/** Exige personal de la biblioteca (BIBLIOTECARIO o ADMINISTRADOR). */
export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(STAFF_ROLES as readonly string[]).includes(user.role)) {
    throw new ForbiddenError("Solo para personal de la biblioteca");
  }
  return user;
}
