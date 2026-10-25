import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadBorrowerRows } from "@/borrower-rows";
import { getContainer } from "@/features/container";
import { LoanCard } from "@/features/loans/ui/loan-card";
import type { LoanRow } from "@/features/loans/ui/loan-rows";
import { BORROWER_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isBorrowerRole(role: Role): boolean {
  return (BORROWER_ROLES as readonly Role[]).includes(role);
}

function OverdueCards({ rows }: { rows: LoanRow[] }) {
  if (rows.length === 0) {
    return <p>No tienes préstamos vencidos.</p>;
  }
  return (
    <>
      <p role="status" className="font-medium text-danger">
        No podrás pedir libros prestados hasta devolverlos.
      </p>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <LoanCard key={row.loan_id} row={row} variant="overdue" />
        ))}
      </ul>
    </>
  );
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. */
async function MyOverdueContent() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  if (!isBorrowerRole(user.role)) {
    return (
      <p role="alert" className="font-medium text-danger">
        Solo para quienes piden libros prestados.
      </p>
    );
  }
  const overdue = await getContainer().loans.listOverdue(user.member_id, user, new Date());
  const rows = await loadBorrowerRows(overdue);
  return <OverdueCards rows={rows} />;
}

/** F35 · Mis préstamos vencidos (solo prestatarios). */
export default function MyOverduePage() {
  return (
    <section aria-labelledby="mis-vencidos-titulo" className="space-y-4">
      <h1 id="mis-vencidos-titulo" className="text-2xl font-semibold">
        Mis vencidos
      </h1>
      <Suspense fallback={<p role="status">Cargando tus préstamos vencidos…</p>}>
        <MyOverdueContent />
      </Suspense>
    </section>
  );
}
