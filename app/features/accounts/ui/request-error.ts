// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { ApiErrorSchema } from "@/shared/schema";
import { HIDDEN_CHARACTERS_MESSAGE } from "../schema";

/**
 * Mensaje de un error de la API para los textos de las solicitudes de docente (F11 y F37). Un 400 de validación trae
 * `{ error: "Datos inválidos", issues }`: si algún `issues[].message` es el de los caracteres invisibles, se muestra
 * ese; si no, `error`. Si el cuerpo no es JSON o no cumple el contrato, se usa `fallback`.
 */
export async function readRequestErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (!parsed.success) {
      return fallback;
    }
    const hidden = parsed.data.issues?.some((issue) => issue.message === HIDDEN_CHARACTERS_MESSAGE);
    if (hidden === true) {
      return HIDDEN_CHARACTERS_MESSAGE;
    }
    return parsed.data.error;
  } catch {
    // El cuerpo no era JSON: se usa el mensaje de respaldo.
  }
  return fallback;
}
