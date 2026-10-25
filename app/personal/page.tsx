import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getContainer } from "@/features/container";
import { StaffForm } from "@/features/accounts/ui/staff-form";
import { StaffList } from "@/features/accounts/ui/staff-list";
import { getSessionUser } from "@/shared/server/http";

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. Solo para el administrador. */
async function StaffContent() {
  // Espera la petición real antes de leer la sesión: verificarla usa la hora actual y la precarga de enlaces no debe prerenderizarla (S1, regla 1).
  await connection();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  // Solo para mostrar u ocultar la pantalla; el servidor valida de verdad.
  if (user.role !== "ADMINISTRADOR") {
    return (
      <p role="alert" className="font-medium text-danger">
        Solo para el administrador.
      </p>
    );
  }
  const members = await getContainer().staff.list(user);
  return (
    <>
      <section aria-labelledby="personal-crear-titulo" className="space-y-4">
        <h2 id="personal-crear-titulo" className="text-xl font-semibold">
          Crear bibliotecario
        </h2>
        <StaffForm />
      </section>
      <section aria-label="Personal" className="space-y-4">
        <StaffList members={members} actor={{ role: user.role, id: user.member_id }} />
      </section>
    </>
  );
}

/** F13–F14 · Personal: crear bibliotecarios y desactivar o reactivar sus cuentas (solo administrador). */
export default function StaffPage() {
  return (
    <section aria-labelledby="personal-titulo" className="space-y-6">
      <h1 id="personal-titulo" className="text-2xl font-semibold">
        Personal
      </h1>
      <Suspense fallback={<p role="status">Cargando personal…</p>}>
        <StaffContent />
      </Suspense>
    </section>
  );
}
