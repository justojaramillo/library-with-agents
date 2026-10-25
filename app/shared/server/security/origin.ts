/** Métodos HTTP que no cambian estado (RFC 9110). */
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export type SameOriginInput = {
  /** Método HTTP de la petición. */
  method: string;
  /** Cabecera `Sec-Fetch-Site`, o `null` si el navegador no la envía. */
  secFetchSite: string | null;
  /** Cabecera `Origin`, o `null` si falta. */
  origin: string | null;
  /** Origen de la URL de la petición (`new URL(req.url).origin`). */
  requestOrigin: string;
  /** `null` = la petición no lleva cuerpo; `""` = lleva cuerpo pero sin `Content-Type`; si no, el valor de la cabecera. */
  contentType: string | null;
};

/** `true` si el `Content-Type` es `application/json` (con o sin parámetros como `charset`). */
function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/** Decide el origen con `Sec-Fetch-Site` y, si falta, con `Origin`. */
function originAllowed(input: SameOriginInput): boolean {
  if (input.secFetchSite !== null) {
    return input.secFetchSite === "same-origin" || input.secFetchSite === "none";
  }
  if (input.origin !== null) {
    return input.origin === input.requestOrigin;
  }
  // Sin ninguna de las dos cabeceras solo se tolera un método seguro (lectura).
  return SAFE_METHODS.includes(input.method.toUpperCase());
}

/**
 * Defensa CSRF para las rutas que cambian estado. Función pura: acepta solo peticiones del mismo origen
 * y, si hay cuerpo, exige `Content-Type: application/json` (un formulario entre sitios no puede enviarlo).
 */
export function checkSameOrigin(input: SameOriginInput): boolean {
  if (!originAllowed(input)) {
    return false;
  }
  if (input.contentType === null) {
    return true;
  }
  return isJsonContentType(input.contentType);
}
