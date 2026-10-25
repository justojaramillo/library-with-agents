import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { AccountList } from "@/features/accounts/ui/account-list";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. */
async function AccountsContent() {
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
  const members = await getContainer().members.list();
  return <AccountList members={members} />;
}

/** F3 · Listado de cuentas (solo personal: bibliotecario o administrador). */
export default function AccountsPage() {
  return (
    <section aria-labelledby="cuentas-titulo" className="space-y-4">
      <h1 id="cuentas-titulo" className="text-2xl font-semibold">
        Cuentas
      </h1>
      <Suspense fallback={<p role="status">Cargando cuentas…</p>}>
        <AccountsContent />
      </Suspense>
    </section>
  );
}
