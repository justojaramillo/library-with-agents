import { unstable_rethrow } from "next/navigation";
import { NavBar, type NavBarUser } from "@/features/accounts/ui/nav-bar";
import { getContainer } from "@/features/container";
import { getSessionUser } from "@/shared/server/http";
import { describeAuthError } from "@/shared/server/security/firebase-errors";

/**
 * Lee la cuenta de la sesión. Cuenta inexistente, inactiva o error de lectura
 * se ven como «sin sesión» (regla 6). El rol sale de la cuenta, no de la cookie (regla 7).
 */
async function readNavUser(): Promise<NavBarUser | null> {
  try {
    const user = await getSessionUser();
    if (!user) {
      return null;
    }
    const member = await getContainer().members.get(user.member_id);
    if (!member || !member.active) {
      return null;
    }
    return { name: member.name, role: member.role };
  } catch (error) {
    // Las señales internas de Next (leer cookies durante el prerender) no son fallos nuestros: deben seguir su camino.
    unstable_rethrow(error);
    // Se ve como «sin sesión» (regla 6), pero el fallo queda en el log: solo el nombre del error, nunca su mensaje.
    console.error("No se pudo leer la sesión para la barra de navegación:", describeAuthError(error));
    return null;
  }
}

/** Componente de servidor: lee la sesión y pasa solo props a la barra. Va dentro de `<Suspense>`. */
export async function SessionNav() {
  const user = await readNavUser();
  return <NavBar user={user} />;
}
