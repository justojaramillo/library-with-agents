/** Códigos de Firebase Authentication que son esperables (credencial inválida, vencida o revocada): no son fallos de infraestructura. */
const EXPECTED_AUTH_CODES = [
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/argument-error",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
  "auth/invalid-session-cookie",
  "auth/user-disabled",
  "auth/user-not-found",
];

/** Código de un error de Firebase (`auth/...`), o `undefined` si el error no lo trae. */
export function firebaseErrorCode<T>(error: T): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (typeof error.code === "string") {
      return error.code;
    }
  }
  return undefined;
}

/** `true` si el error es un rechazo normal de credenciales y no un fallo de infraestructura. */
export function isExpectedAuthError<T>(error: T): boolean {
  const code = firebaseErrorCode(error);
  if (code === undefined) {
    return false;
  }
  return EXPECTED_AUTH_CODES.includes(code);
}

/** Descripción segura para el log: solo el código o el nombre del error, nunca su mensaje ni valores. */
export function describeAuthError<T>(error: T): string {
  const code = firebaseErrorCode(error);
  if (code !== undefined) {
    return code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "error desconocido";
}
