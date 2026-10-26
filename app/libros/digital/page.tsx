import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DigitalPanel } from "@/features/reader/ui/digital-panel";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";

/** Solo para mostrar u ocultar la pantalla; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Parte dinámica: lee la cookie de sesión, por eso va dentro de `<Suspense>`. Solo para el personal. */
async function DigitalContent() {
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
  return <DigitalPanel />;
}

/** F27 · Contenido digital de un libro (solo personal: bibliotecario o administrador). */
export default function DigitalContentPage() {
  return (
    <section aria-labelledby="contenido-digital-titulo" className="space-y-6">
      <h1 id="contenido-digital-titulo" className="text-2xl font-semibold">
        Contenido digital
      </h1>
      <Suspense fallback={<p role="status">Cargando pantalla…</p>}>
        <DigitalContent />
      </Suspense>
      <p>
        <Link href="/" className="inline-flex min-h-11 items-center font-medium">
          Volver al catálogo
        </Link>
      </p>
    </section>
  );
}
