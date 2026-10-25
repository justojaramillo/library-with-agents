import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ZodError } from "zod";
import { getContainer } from "@/features/container";
import {
  type TeacherRequestPage,
  type TeacherRequestStatus,
  TeacherRequestStatusSchema,
} from "@/features/accounts/schema";
import { AccountPagination, PageNotFound } from "@/features/accounts/ui/account-pagination";
import { TeacherRequestList } from "@/features/accounts/ui/teacher-request-list";
import { RequestStatusNav } from "@/features/accounts/ui/teacher-request-tabs";
import { IdSchema, STAFF_ROLES, type Role, type SessionUser } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

type RequestsSearchParams = PageProps<"/solicitudes">["searchParams"];

const PAGE_SIZE = 50;
const DEFAULT_STATUS: TeacherRequestStatus = "PENDIENTE";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Estado pedido en la dirección; ausente, repetido o inválido es «Pendientes». */
function parseStatus(value: string | string[] | undefined): TeacherRequestStatus {
  const parsed = TeacherRequestStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return DEFAULT_STATUS;
}

/** Cursor de la página: solo se acepta un valor simple y válido; cualquier otra cosa es la primera página. */
function parseAfter(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = IdSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return undefined;
}

/**
 * Pide la página; un cursor que no existe devuelve `null`.
 * Solo el `ZodError` del servicio (cursor inexistente) se muestra como «No se encontró esa página»;
 * cualquier otro error se propaga a `app/error.tsx`.
 */
async function loadPage(
  user: SessionUser,
  status: TeacherRequestStatus,
  after: string | undefined,
): Promise<TeacherRequestPage | null> {
  try {
    return await getContainer().teacherRequests.list(user, { status, limit: PAGE_SIZE, after });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError) {
      return null;
    }
    throw error;
  }
}

/** Parte dinámica: lee la cookie de sesión y `searchParams`, por eso va dentro de `<Suspense>`. */
async function RequestsContent({ searchParams }: { searchParams: RequestsSearchParams }) {
  const params = await searchParams;
  // Espera la petición real antes de leer la sesión: verificarla usa la hora actual y la precarga de enlaces no debe prerenderizarla (S1, regla 1).
  await connection();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  if (!isStaff(user.role)) {
    return (
      <p role="alert" className="font-medium text-danger">
        Solo para el personal de la biblioteca.
      </p>
    );
  }
  const status = parseStatus(params.status);
  const after = parseAfter(params.after);
  const page = await loadPage(user, status, after);
  const target = { basePath: "/solicitudes", extraParams: { status }, label: "Paginación de solicitudes" };
  if (page === null) {
    return (
      <>
        <RequestStatusNav current={status} />
        <PageNotFound {...target} />
      </>
    );
  }
  return (
    <>
      <RequestStatusNav current={status} />
      <TeacherRequestList requests={page.requests} status={status} />
      <AccountPagination nextAfter={page.next_after} hasCursor={after !== undefined} {...target} />
    </>
  );
}

/** F37 · Solicitudes de docente: verlas, aprobarlas o rechazarlas (solo personal: bibliotecario o administrador). */
export default function RequestsPage({ searchParams }: PageProps<"/solicitudes">) {
  return (
    <section aria-labelledby="solicitudes-titulo" className="space-y-4">
      <h1 id="solicitudes-titulo" className="text-2xl font-semibold">
        Solicitudes de docente
      </h1>
      <Suspense fallback={<p role="status">Cargando solicitudes…</p>}>
        <RequestsContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
