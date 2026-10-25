import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { MemberForm } from "@/features/accounts/ui/member-form";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. Solo para el personal. */
async function NewMemberContent() {
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
  return <MemberForm />;
}

/** F36 · Crear una cuenta de mostrador, externa o estudiante (solo personal: bibliotecario o administrador). */
export default function NewMemberPage() {
  return (
    <section aria-labelledby="cuenta-nueva-titulo" className="space-y-6">
      <h1 id="cuenta-nueva-titulo" className="text-2xl font-semibold">
        Nueva cuenta
      </h1>
      <Suspense fallback={<p role="status">Cargando formulario…</p>}>
        <NewMemberContent />
      </Suspense>
      <p>
        <Link href="/cuentas" className="inline-flex min-h-11 items-center font-medium">
          Volver a cuentas
        </Link>
      </p>
    </section>
  );
}
