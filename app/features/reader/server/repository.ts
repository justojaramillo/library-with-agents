import type { Id } from "@/shared/schema";

/** Mensaje del 409 cuando otra subida se adelantó (F27, regla 6). */
export const CONTENT_CONFLICT_MESSAGE =
  "Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.";

/** Datos del contenido cargado de un libro. La ruta es interna: nunca sale al exterior (F27, regla 5). */
export type DigitalContent = { path: string; bytes: number; updatedAt: string };

/** Lo que el lector guarda en `books/{id}` (F27). `content` es `null` si el libro no tiene contenido. */
export type DigitalBookRecord = {
  id: Id;
  title: string;
  digital_copies: number;
  content: DigitalContent | null;
};

/** Almacén de los textos (Vercel Blob privado, ADR-0003). Los servicios no usan el SDK directo. */
export interface ContentStore {
  /** Guarda el texto en un archivo nuevo bajo `books/{bookId}/` y devuelve su ruta. */
  put(bookId: Id, markdown: string): Promise<{ path: string }>;
  /** Texto del archivo, o `undefined` si no existe (lo usa F28). */
  get(path: string): Promise<string | undefined>;
  /** Borra el archivo. */
  remove(path: string): Promise<void>;
}

/** Campos digitales del libro (`books/{id}`). Solo toca `digital_copies` y `content_*`; el resto del libro no. */
export interface DigitalBookRepository {
  find(bookId: Id): Promise<DigitalBookRecord | undefined>;
  /** Fija las copias y devuelve el libro actualizado, o `undefined` si el libro no existe. */
  setCopies(bookId: Id, copies: number): Promise<DigitalBookRecord | undefined>;
  /**
   * Apunta el libro al contenido nuevo en una transacción. `expectedPath` es la ruta que el llamador vio (o `null`
   * si no había contenido): si cambió, lanza `ConflictError`. Libro inexistente → `NotFoundError`.
   * Devuelve la ruta anterior para que el servicio la borre.
   */
  replaceContent(
    bookId: Id,
    expectedPath: string | null,
    next: DigitalContent,
  ): Promise<{ previousPath: string | null }>;
}

/** Préstamos digitales activos de un libro. F38 lo implementa de verdad; hasta entonces el contenedor devuelve 0. */
export interface ActiveDigitalLoansReader {
  countActiveDigitalByBook(bookId: Id): Promise<number>;
}
