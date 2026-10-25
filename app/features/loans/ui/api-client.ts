import { ApiErrorSchema } from "@/shared/schema";

export const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Ingresa de nuevo.";

/**
 * Mensaje de una respuesta de error de la API. El cuerpo se valida con el contrato en el mismo punto
 * de lectura; un 401 siempre dice que la sesión expiró; si el cuerpo no sirve, se usa el mensaje de respaldo.
 */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) {
    return SESSION_EXPIRED_MESSAGE;
  }
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
