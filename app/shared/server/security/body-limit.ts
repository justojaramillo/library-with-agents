import { ZodError } from "zod";

/** 400 de validación: el cuerpo supera el tope. Lo traduce `handleError` como cualquier error de Zod. */
function bodyTooLarge(): ZodError {
  return new ZodError([{ code: "custom", path: [], message: "El cuerpo de la petición es demasiado grande." }]);
}

/** `content-length` declarado, o `undefined` si falta o no es un número válido. */
function declaredLength(req: Request): number | undefined {
  const header = req.headers.get("content-length");
  if (header === null) {
    return undefined;
  }
  const length = Number(header);
  if (!Number.isFinite(length) || length < 0) {
    return undefined;
  }
  return length;
}

/**
 * Lee el cuerpo como texto sin pasarse de `maxBytes`: rechaza antes de leer si `content-length` ya lo supera y,
 * si falta o miente, corta en cuanto lo leído lo supera. Un exceso lanza `ZodError` (400). Cuerpo vacío → `""`.
 */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = declaredLength(req);
  if (declared !== undefined && declared > maxBytes) {
    throw bodyTooLarge();
  }
  if (req.body === null) {
    return "";
  }
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) {
      break;
    }
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw bodyTooLarge();
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}
