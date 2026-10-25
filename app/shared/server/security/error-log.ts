import { firebaseErrorCode } from "./firebase-errors";

/**
 * Descripción segura de un error para el log (S1, regla 15): nombre, `code` si es texto y mensaje recortado a
 * 200 caracteres. Nunca la pila ni las propiedades del objeto (pueden traer datos de la petición o credenciales).
 */
export function describeLoggedError<T>(error: T): string {
  if (!(error instanceof Error)) {
    return "Error no estándar";
  }
  const code = firebaseErrorCode(error);
  const message = error.message.slice(0, 200);
  if (code === undefined) {
    return `${error.name}: ${message}`;
  }
  return `${error.name} [${code}]: ${message}`;
}
