import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ZodError } from "zod";
import { getContainer } from "@/features/container";
import type { MemberPage } from "@/features/accounts/schema";
import { AccountList } from "@/features/accounts/ui/account-list";
import { AccountPagination, PageNotFound } from "@/features/accounts/ui/account-pagination";
import { IdSchema, STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";
import { ButtonLink } from "@/shared/ui/button-link";

type AccountsSearchParams = PageProps<"/cuentas">["searchParams"];

const PAGE_SIZE = 50;

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
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
 * Solo el `ZodError` del servicio (cursor inexistente) se muestra como «No se encontró esa página».
 * Un documento corrupto ya no llega como `ZodError`: el repositorio lo convierte en error interno (S1, regla 16),
 * y como cualquier otro `Error` se propaga a `app/error.tsx`.
 */
async function loadPage(after: string | undefined): Promise<MemberPage | null> {
  try {
    return await getContainer().members.list({ limit: PAGE_SIZE, after });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError) {
      return null;
    }
    throw error;
  }
}

/** Parte dinámica: lee la cookie de sesión y `searchParams`, por eso va dentro de `<Suspense>`. */
async function AccountsContent({ searchParams }: { searchParams: AccountsSearchParams }) {
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
  const after = parseAfter(params.after);
  const page = await loadPage(after);
  if (page === null) {
    return <PageNotFound />;
  }
  return (
    <>
      <p>
        <ButtonLink href="/cuentas/nuevo">Nueva cuenta</ButtonLink>
      </p>
      <AccountList members={page.members} actor={{ role: user.role, id: user.member_id }} />
      <AccountPagination nextAfter={page.next_after} hasCursor={after !== undefined} />
    </>
  );
}

/** F3 · Listado de cuentas paginado (solo personal: bibliotecario o administrador). */
export default function AccountsPage({ searchParams }: PageProps<"/cuentas">) {
  return (
    <section aria-labelledby="cuentas-titulo" className="space-y-4">
      <h1 id="cuentas-titulo" className="text-2xl font-semibold">
        Cuentas
      </h1>
      <Suspense fallback={<p role="status">Cargando cuentas…</p>}>
        <AccountsContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
