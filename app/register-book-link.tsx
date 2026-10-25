import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { STAFF_ROLES, type Role } from "@/shared/schema";
import { getSessionUser } from "@/shared/server/http";
import { ButtonLink } from "@/shared/ui/button-link";

/** Solo para mostrar u ocultar el botón; el servidor valida de verdad. */
function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** `true` si hay una sesión de personal. Cualquier fallo de lectura se ve como «sin botón». */
async function readIsStaff(): Promise<boolean> {
  // Espera la petición real antes de leer la sesión: verificarla usa la hora actual y la precarga de enlaces no debe prerenderizarla (S1, regla 1).
  await connection();
  try {
    const user = await getSessionUser();
    if (user === null) {
      return false;
    }
    return isStaff(user.role);
  } catch (error) {
    // Las señales internas de Next (leer cookies durante el prerender) no son fallos nuestros: deben seguir su camino.
    unstable_rethrow(error);
    return false;
  }
}

/**
 * F36 · Botón «Registrar libro», solo para el personal. Visitantes y prestatarios no ven nada. Lee la sesión, por eso
 * va dentro de `<Suspense fallback={null}>`: el resto de la página sigue prerenderizado.
 */
export async function RegisterBookLink() {
  if (!(await readIsStaff())) {
    return null;
  }
  return <ButtonLink href="/libros/nuevo">Registrar libro</ButtonLink>;
}
