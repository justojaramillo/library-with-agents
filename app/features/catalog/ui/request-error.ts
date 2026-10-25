// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { ApiErrorSchema } from "@/shared/schema";

/**
 * Mensaje de un error de la API: el `error` del cuerpo si cumple el contrato (`ApiErrorSchema`, validado en el mismo
 * punto en que se lee); si el cuerpo no es JSON o no lo cumple, `fallback`.
 */
export async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    // El cuerpo no era JSON: se usa el mensaje de respaldo.
  }
  return fallback;
}
