import { IdSchema, STAFF_ROLES, type Id, type SessionUser } from "@/shared/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { describeLoggedError } from "@/shared/server/security/error-log";
import {
  DIGITAL_RULES,
  SetDigitalCopiesInputSchema,
  UploadContentInputSchema,
  type DigitalInfo,
  type SetDigitalCopiesInput,
  type UploadContentInput,
} from "../schema";
import type { ActiveDigitalLoansReader, ContentStore, DigitalBookRecord, DigitalBookRepository } from "./repository";

export type DigitalService = {
  /** F27 · Estado digital del libro (regla 9). Solo personal. Nunca devuelve el texto ni la ruta. */
  info(actor: SessionUser, bookId: string): Promise<DigitalInfo>;
  /**
   * F27 · Fija las copias digitales (reglas 1–3). Orden: personal (403) → id y cuerpo (400) → libro inexistente (404)
   * → no bajar de los préstamos digitales activos (409). El cuerpo llega sin validar del todo y se valida aquí.
   */
  setCopies(actor: SessionUser, bookId: string, input: Partial<SetDigitalCopiesInput>): Promise<DigitalInfo>;
  /**
   * F27 · Carga o reemplaza el contenido (reglas 4–7). Orden: personal (403) → id y cuerpo (400) → libro inexistente
   * (404) → subida y actualización con compensaciones (409 si otra subida se adelantó). `now` es el instante guardado.
   */
  uploadContent(
    actor: SessionUser,
    bookId: string,
    input: Partial<UploadContentInput>,
    now: Date,
  ): Promise<DigitalInfo>;
};

export type DigitalServiceDeps = {
  books: DigitalBookRepository;
  store: ContentStore;
  activeLoans: ActiveDigitalLoansReader;
};

const STAFF_MESSAGE = "Solo para personal de la biblioteca";
const BOOK_NOT_FOUND = "El libro no existe.";

/** Cuerpo del `PUT`: el esquema del contrato más las reglas de contenido que dependen de los bytes (regla 4). */
const ContentBodySchema = UploadContentInputSchema.extend({
  markdown: UploadContentInputSchema.shape.markdown
    .refine((text) => text.trim().length > 0, "El contenido no puede estar vacío.")
    .refine((text) => !text.includes("\u0000"), "El contenido no puede llevar el carácter nulo.")
    .refine((text) => utf8Bytes(text) <= DIGITAL_RULES.maxMarkdownBytes, "El contenido supera los 2 MB."),
});

/** Tamaño en bytes UTF-8 (no en caracteres). */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function assertStaff(actor: SessionUser): void {
  if (!(STAFF_ROLES as readonly string[]).includes(actor.role)) {
    throw new ForbiddenError(STAFF_MESSAGE);
  }
}

function toInfo(record: DigitalBookRecord): DigitalInfo {
  if (record.content === null) {
    return {
      book_id: record.id,
      title: record.title,
      digital_copies: record.digital_copies,
      has_content: false,
      content_bytes: null,
      content_updated_at: null,
    };
  }
  return {
    book_id: record.id,
    title: record.title,
    digital_copies: record.digital_copies,
    has_content: true,
    content_bytes: record.content.bytes,
    content_updated_at: record.content.updatedAt,
  };
}

async function findOrFail(books: DigitalBookRepository, bookId: Id): Promise<DigitalBookRecord> {
  const record = await books.find(bookId);
  if (record === undefined) {
    throw new NotFoundError(BOOK_NOT_FOUND);
  }
  return record;
}

/** Compensación (regla 6): borra el archivo nuevo. Si el borrado falla se registra (sin ruta) y se sigue. */
async function discardNewFile(store: ContentStore, bookId: Id, path: string): Promise<void> {
  try {
    await store.remove(path);
  } catch (error) {
    console.error(`No se pudo borrar el archivo nuevo del libro ${bookId}:`, describeLoggedError(error));
  }
}

/**
 * Fallo ambiguo (regla 6): vuelve a leer el libro y dice si ya apunta al archivo nuevo, es decir, si la transacción
 * sí se confirmó aunque `replaceContent` haya fallado. Si la relectura falla, se registra y cuenta como «no apunta».
 */
async function pointsToNewFile(books: DigitalBookRepository, bookId: Id, path: string): Promise<boolean> {
  try {
    const current = await books.find(bookId);
    if (current === undefined || current.content === null) {
      return false;
    }
    return current.content.path === path;
  } catch (error) {
    console.error(`No se pudo releer el libro ${bookId} tras un fallo ambiguo:`, describeLoggedError(error));
    return false;
  }
}

/** Regla 6: el archivo anterior ya no se usa. Si no se puede borrar, la subida no falla; queda un huérfano. */
async function discardPreviousFile(store: ContentStore, bookId: Id, path: string | null): Promise<void> {
  if (path === null) {
    return;
  }
  try {
    await store.remove(path);
  } catch (error) {
    console.warn(`No se pudo borrar el archivo anterior del libro ${bookId}:`, describeLoggedError(error));
  }
}

export function createDigitalService(deps: DigitalServiceDeps): DigitalService {
  return {
    async info(actor, bookId) {
      assertStaff(actor);
      const id = IdSchema.parse(bookId);
      return toInfo(await findOrFail(deps.books, id));
    },
    async setCopies(actor, bookId, input) {
      assertStaff(actor);
      const id = IdSchema.parse(bookId);
      const body = SetDigitalCopiesInputSchema.parse(input);
      await findOrFail(deps.books, id);
      const active = await deps.activeLoans.countActiveDigitalByBook(id);
      if (body.digital_copies < active) {
        throw new ConflictError(`No puedes dejar menos copias digitales que préstamos digitales activos (${active}).`);
      }
      const updated = await deps.books.setCopies(id, body.digital_copies);
      if (updated === undefined) {
        throw new NotFoundError(BOOK_NOT_FOUND);
      }
      return toInfo(updated);
    },
    async uploadContent(actor, bookId, input, now) {
      assertStaff(actor);
      const id = IdSchema.parse(bookId);
      const { markdown } = ContentBodySchema.parse(input);
      const book = await findOrFail(deps.books, id);
      let expectedPath: string | null = null;
      if (book.content !== null) {
        expectedPath = book.content.path;
      }
      const stored = await deps.store.put(id, markdown);
      const next = { path: stored.path, bytes: utf8Bytes(markdown), updatedAt: now.toISOString() };
      let previousPath: string | null = null;
      try {
        const replaced = await deps.books.replaceContent(id, expectedPath, next);
        previousPath = replaced.previousPath;
      } catch (error) {
        if (error instanceof ConflictError || error instanceof NotFoundError) {
          await discardNewFile(deps.store, id, stored.path);
          throw error;
        }
        if (await pointsToNewFile(deps.books, id, stored.path)) {
          console.warn(`La actualización del libro ${id} falló pero se confirmó; el archivo anterior queda huérfano.`);
          return toInfo({ ...book, content: next });
        }
        await discardNewFile(deps.store, id, stored.path);
        throw error;
      }
      await discardPreviousFile(deps.store, id, previousPath);
      return toInfo({ ...book, content: next });
    },
  };
}
