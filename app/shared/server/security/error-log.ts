import { firebaseErrorCode } from "./firebase-errors";

const INDEX_LINK_PATTERN = /https:\/\/console\.firebase\.google\.com\/\S*/;
const INDEX_LINK_MAX_LENGTH = 2000;

/**
 * Enlace de creación de índice que Firestore incluye en los errores `FAILED_PRECONDITION` («requires an
 * index»): el primer enlace de la consola de Firebase, completo (hasta el primer espacio) y con tope de 2000
 * caracteres. Si el mensaje no pide un índice o no trae enlace, devuelve `undefined`.
 */
function extractIndexLink(message: string): string | undefined {
  if (!message.includes("requires an index")) {
    return undefined;
  }
  const match = INDEX_LINK_PATTERN.exec(message);
  if (match === null) {
    return undefined;
  }
  return match[0].slice(0, INDEX_LINK_MAX_LENGTH);
}

/**
 * Descripción segura de un error para el log (S1, regla 15): nombre, `code` si es texto y mensaje recortado a
 * 200 caracteres. Nunca la pila ni las propiedades del objeto (pueden traer datos de la petición o credenciales).
 * Excepción aditiva: si el mensaje pide un índice de Firestore, se añade al final el enlace de creación completo.
 */
export function describeLoggedError<T>(error: T): string {
  if (!(error instanceof Error)) {
    return "Error no estándar";
  }
  const code = firebaseErrorCode(error);
  const message = error.message.slice(0, 200);
  let description = `${error.name}: ${message}`;
  if (code !== undefined) {
    description = `${error.name} [${code}]: ${message}`;
  }
  const indexLink = extractIndexLink(error.message);
  if (indexLink === undefined) {
    return description;
  }
  return `${description} | enlace del índice: ${indexLink}`;
}
