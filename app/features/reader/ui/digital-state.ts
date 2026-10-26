// El orden importa, no lo reordenes: fija Zod sin compilación antes de cargar esquemas (CSP).
import "@/shared/ui/client-setup";
import { DEFAULT_TIME_ZONE, formatDate } from "@/features/loans/ui/format";
import { DIGITAL_RULES, type DigitalInfo } from "../schema";

export const DIGITAL_DEFAULT_ERROR = "No se pudo completar la acción";
export const DIGITAL_SESSION_ENDED_ERROR = "Tu sesión terminó. Vuelve a ingresar.";
export const DIGITAL_RATE_LIMIT_ERROR = "Demasiadas cargas. Inténtalo más tarde.";
export const FILE_EMPTY_ERROR = "El archivo está vacío.";
export const FILE_TOO_BIG_ERROR = "El archivo supera los 2 MB.";
export const FILE_UNREADABLE_ERROR = "No se pudo leer el archivo. Elígelo de nuevo.";
export const FILE_MISSING_ERROR = "Elige un archivo .md, .markdown o .txt.";

/** Un byte de más por encima del límite no basta para saber nada: la marca de orden de bytes (3 bytes) no cuenta. */
const BYTE_ORDER_MARK_BYTES = 3;
const BYTES_PER_KILOBYTE = 1000;

/** Error de una llamada a `/api/books/:id/digital…`: el estado HTTP y el mensaje que mandó el servidor (o el de respaldo). */
export class DigitalRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DigitalRequestError";
    this.status = status;
  }
}

/**
 * Mensaje para un error de las llamadas digitales: 429 → «Demasiadas cargas…»; 401 y 403 → sesión terminada; otro
 * error del servidor (400, 404, 409…) → su propio mensaje; cualquier otra cosa (red, cuerpo ilegible) →
 * «No se pudo completar la acción». El `catch` lo pasa tal cual, sin anotarle tipo.
 */
export function messageForDigitalError<T>(error: T): string {
  if (!(error instanceof DigitalRequestError)) {
    return DIGITAL_DEFAULT_ERROR;
  }
  if (error.status === 429) {
    return DIGITAL_RATE_LIMIT_ERROR;
  }
  if (error.status === 401 || error.status === 403) {
    return DIGITAL_SESSION_ENDED_ERROR;
  }
  return error.message;
}

/** Tamaño en bytes del texto codificado en UTF-8 (no en caracteres), igual que lo cuenta el servidor. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** «1,5 KB» (1 KB = 1000 bytes, como el límite de 2 MB = 2 000 000 bytes). Lo que no está vacío nunca baja de «0,1 KB». */
export function formatKilobytes(bytes: number): string {
  let kilobytes = Math.round((bytes / BYTES_PER_KILOBYTE) * 10) / 10;
  if (bytes > 0 && kilobytes < 0.1) {
    kilobytes = 0.1;
  }
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(kilobytes)} KB`;
}

const ALLOWED_EXTENSIONS = [".md", ".markdown", ".txt"];
export const COPIES_INVALID_ERROR = "Escribe un número entero de 0 a 100.";

/** `true` si el nombre del archivo termina en `.md`, `.markdown` o `.txt` (sin distinguir mayúsculas). */
export function isAllowedFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Número de copias digitales escrito en el campo (entero de 0 a 100), o `null` si no vale. */
export function parseDigitalCopies(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (value > DIGITAL_RULES.maxCopies) {
    return null;
  }
  return value;
}

/** Mensaje de error del texto de un archivo, o `null` si se puede enviar: vacío (tras recortar) o de más de 2 MB en UTF-8. */
export function validateMarkdownFile(text: string): string | null {
  if (text.trim() === "") {
    return FILE_EMPTY_ERROR;
  }
  if (utf8ByteLength(text) > DIGITAL_RULES.maxMarkdownBytes) {
    return FILE_TOO_BIG_ERROR;
  }
  return null;
}

/** Texto leído de un archivo ya validado, o el mensaje de por qué no sirve. */
export type MarkdownRead = { ok: true; text: string } | { ok: false; message: string };

/** Lee el archivo en el navegador y lo valida. Un archivo claramente grande se rechaza sin leerlo. */
export async function readMarkdownFile(file: File): Promise<MarkdownRead> {
  if (file.size > DIGITAL_RULES.maxMarkdownBytes + BYTE_ORDER_MARK_BYTES) {
    return { ok: false, message: FILE_TOO_BIG_ERROR };
  }
  let text = "";
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: FILE_UNREADABLE_ERROR };
  }
  const message = validateMarkdownFile(text);
  if (message !== null) {
    return { ok: false, message };
  }
  return { ok: true, text };
}

/** Las dos líneas del estado de un libro: copias y contenido. */
export type DigitalStateText = { copies: string; content: string };

/**
 * «Copias digitales: N» y «Contenido: cargado (X KB, el {fecha})» o «Contenido: sin cargar». La fecha va en la zona
 * indicada (por defecto la de Bogotá, igual que el resto de pantallas).
 */
export function describeDigitalState(info: DigitalInfo, timeZone: string = DEFAULT_TIME_ZONE): DigitalStateText {
  const copies = `Copias digitales: ${info.digital_copies}`;
  if (!info.has_content || info.content_bytes === null) {
    return { copies, content: "Contenido: sin cargar" };
  }
  const size = formatKilobytes(info.content_bytes);
  if (info.content_updated_at === null) {
    return { copies, content: `Contenido: cargado (${size})` };
  }
  return { copies, content: `Contenido: cargado (${size}, el ${formatDate(info.content_updated_at, timeZone)})` };
}

/** Aviso de éxito al fijar las copias. */
export function savedCopiesMessage(title: string, copies: number): string {
  if (copies === 1) {
    return `Se guardó 1 copia digital de «${title}».`;
  }
  return `Se guardaron ${copies} copias digitales de «${title}».`;
}

/** Aviso de éxito al cargar el contenido. */
export function uploadedContentMessage(info: DigitalInfo): string {
  if (info.content_bytes === null) {
    return `Se cargó el contenido de «${info.title}».`;
  }
  return `Se cargó el contenido de «${info.title}» (${formatKilobytes(info.content_bytes)}).`;
}
