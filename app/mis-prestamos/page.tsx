import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadBorrowerRows } from "@/borrower-rows";
import { getContainer } from "@/features/container";
import { LOAN_RULES } from "@/features/loans/schema";
import { LoanCard } from "@/features/loans/ui/loan-card";
import type { LoanRow } from "@/features/loans/ui/loan-rows";
import { BORROWER_ROLES, type BorrowerRole, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isBorrowerRole(role: Role): role is BorrowerRole {
  return (BORROWER_ROLES as readonly Role[]).includes(role);
}

function Summary({ count, quota }: { count: number; quota: number }) {
  return (
    <p className="text-lg">
      <strong className="font-semibold">
        {count} de {quota}
      </strong>{" "}
      préstamos activos
    </p>
  );
}

function LoanCards({ rows }: { rows: LoanRow[] }) {
  if (rows.length === 0) {
    return <p>No tienes préstamos activos.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <LoanCard key={row.loan_id} row={row} />
      ))}
    </ul>
  );
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. */
async function MyLoansContent() {
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
  const active = await getContainer().loans.listActiveByMember(user.member_id, user, new Date());
  const rows = await loadBorrowerRows(active);
  return (
    <>
      <Summary count={rows.length} quota={LOAN_RULES.maxActiveLoansByRole[user.role]} />
      <LoanCards rows={rows} />
    </>
  );
}

/** F35 · Mis préstamos activos (solo prestatarios). */
export default function MyLoansPage() {
  return (
    <section aria-labelledby="mis-prestamos-titulo" className="space-y-4">
      <h1 id="mis-prestamos-titulo" className="text-2xl font-semibold">
        Mis préstamos
      </h1>
      <Suspense fallback={<p role="status">Cargando tus préstamos…</p>}>
        <MyLoansContent />
      </Suspense>
    </section>
  );
}
