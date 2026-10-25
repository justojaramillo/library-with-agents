import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { ActiveLoansList } from "@/features/loans/ui/active-loans-list";
import { LendForm } from "@/features/loans/ui/lend-form";
import { joinLoanRows } from "@/features/loans/ui/loan-rows";
import type { ActiveLoan } from "@/features/loans/schema";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

const BATCH_SIZE = 500;

/** Parte una lista de ids en fragmentos de como máximo `size` elementos. */
function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size));
  }
  return chunks;
}

/** Lee por fragmentos de 500 ids (límite de `getMany`) y une los resultados; con 0 ids no consulta nada. */
async function readInBatches<T>(ids: string[], getMany: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const results = await Promise.all(chunkIds(ids, BATCH_SIZE).map((batch) => getMany(batch)));
  return results.flat();
}

/** Cuentas y libros de los préstamos listados: solo los ids necesarios, cada uno una sola vez. */
async function loadRows(active: ActiveLoan[]) {
  const container = getContainer();
  const memberIds = [...new Set(active.map((item) => item.loan.member_id))];
  const bookIds = [...new Set(active.map((item) => item.loan.book_id))];
  const [members, books] = await Promise.all([
    readInBatches(memberIds, (batch) => container.members.getMany(batch)),
    readInBatches(bookIds, (batch) => container.books.getSummaries(batch)),
  ]);
  return joinLoanRows(active, members, books);
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. */
async function LoansContent() {
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
  const active = await getContainer().loans.listActive(user, new Date());
  const rows = await loadRows(active);
  return (
    <>
      <section aria-labelledby="prestar-titulo" className="space-y-4">
        <h2 id="prestar-titulo" className="text-xl font-semibold">
          Prestar un libro
        </h2>
        <LendForm />
      </section>
      <section aria-labelledby="activos-titulo" className="space-y-4">
        <h2 id="activos-titulo" className="text-xl font-semibold">
          Préstamos activos
        </h2>
        <ActiveLoansList rows={rows} />
      </section>
    </>
  );
}

/** F34 · Préstamos: prestar, ver los activos y recibir devoluciones (solo personal). */
export default function LoansPage() {
  return (
    <section aria-labelledby="prestamos-titulo" className="space-y-6">
      <h1 id="prestamos-titulo" className="text-2xl font-semibold">
        Préstamos
      </h1>
      <Suspense fallback={<p role="status">Cargando préstamos…</p>}>
        <LoansContent />
      </Suspense>
    </section>
  );
}
