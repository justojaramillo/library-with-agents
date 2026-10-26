import type { Id } from "@/shared/schema";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import {
  CONTENT_CONFLICT_MESSAGE,
  type ActiveDigitalLoansReader,
  type ContentStore,
  type DigitalBookRecord,
  type DigitalBookRepository,
  type DigitalContent,
} from "./repository";

/** Operaciones del almacén en las que se puede inyectar un fallo. */
export type StoreOperation = "put" | "remove";

/** Almacén en memoria para pruebas, con fallos inyectables de un solo uso y ayudantes para inspeccionarlo. */
export type MemoryContentStore = ContentStore & {
  /** El próximo `put`/`remove` lanza `error` (por defecto un `Error` genérico) y después todo vuelve a funcionar. */
  failNext(operation: StoreOperation, error?: Error): void;
  /** Rutas de todos los archivos guardados, en orden de creación. */
  paths(): string[];
  /** Texto guardado en `path`, o `undefined`. */
  text(path: string): string | undefined;
  /** Rutas que se intentaron borrar (con éxito o no), en orden. */
  removed(): string[];
};

/** Libro con el que se siembra el repositorio en memoria. */
export type MemoryDigitalBookSeed = {
  id: Id;
  title: string;
  digital_copies?: number;
  content?: DigitalContent;
};

/** Repositorio en memoria para pruebas, con fallo inyectable en `replaceContent`. */
export type MemoryDigitalBookRepository = DigitalBookRepository & {
  /** Añade (o sustituye) un libro. `digital_copies` vale 0 si no se indica; sin `content`, no tiene contenido. */
  addBook(book: MemoryDigitalBookSeed): void;
  /** El próximo `replaceContent` lanza `error` (por defecto un `Error` genérico) y después todo vuelve a funcionar. */
  failNextReplace(error?: Error): void;
  /**
   * Fallo «posterior a confirmar»: el próximo `replaceContent` aplica el cambio y después lanza `error` (por defecto
   * un `Error` genérico), como si se hubiera perdido la respuesta. Después todo vuelve a funcionar.
   */
  failNextReplaceAfterCommit(error?: Error): void;
  /** El próximo `find` lanza `error` (por defecto un `Error` genérico) y después todo vuelve a funcionar. */
  failNextFind(error?: Error): void;
};

/** Contador falso de préstamos digitales activos, configurable por libro (0 si no se indica). */
export type FakeActiveDigitalLoans = ActiveDigitalLoansReader & {
  setActive(bookId: Id, count: number): void;
};

function copyRecord(record: DigitalBookRecord): DigitalBookRecord {
  if (record.content === null) {
    return { ...record, content: null };
  }
  return { ...record, content: { ...record.content } };
}

export function createMemoryContentStore(): MemoryContentStore {
  const files = new Map<string, string>();
  const removedPaths: string[] = [];
  const pending = new Map<StoreOperation, Error>();
  let counter = 0;

  function takeFailure(operation: StoreOperation): Error | undefined {
    const error = pending.get(operation);
    pending.delete(operation);
    return error;
  }

  return {
    failNext(operation, error = new Error(`Fallo inyectado en ${operation}`)) {
      pending.set(operation, error);
    },
    paths() {
      return [...files.keys()];
    },
    text(path) {
      return files.get(path);
    },
    removed() {
      return [...removedPaths];
    },
    async put(bookId, markdown) {
      const failure = takeFailure("put");
      if (failure !== undefined) {
        throw failure;
      }
      counter += 1;
      const path = `books/${bookId}/content-${counter}.md`;
      files.set(path, markdown);
      return { path };
    },
    async get(path) {
      return files.get(path);
    },
    async remove(path) {
      removedPaths.push(path);
      const failure = takeFailure("remove");
      if (failure !== undefined) {
        throw failure;
      }
      files.delete(path);
    },
  };
}

export function createMemoryDigitalBookRepository(): MemoryDigitalBookRepository {
  const rows = new Map<Id, DigitalBookRecord>();
  let replaceFailure: Error | undefined;
  let replaceAfterCommitFailure: Error | undefined;
  let findFailure: Error | undefined;

  return {
    addBook(book) {
      rows.set(book.id, {
        id: book.id,
        title: book.title,
        digital_copies: book.digital_copies ?? 0,
        content: book.content ?? null,
      });
    },
    failNextReplace(error = new Error("Fallo inyectado en replaceContent")) {
      replaceFailure = error;
    },
    failNextReplaceAfterCommit(error = new Error("Fallo inyectado tras confirmar replaceContent")) {
      replaceAfterCommitFailure = error;
    },
    failNextFind(error = new Error("Fallo inyectado en find")) {
      findFailure = error;
    },
    async find(bookId) {
      if (findFailure !== undefined) {
        const failure = findFailure;
        findFailure = undefined;
        throw failure;
      }
      const row = rows.get(bookId);
      if (row === undefined) {
        return undefined;
      }
      return copyRecord(row);
    },
    async setCopies(bookId, copies) {
      const row = rows.get(bookId);
      if (row === undefined) {
        return undefined;
      }
      row.digital_copies = copies;
      return copyRecord(row);
    },
    async replaceContent(bookId, expectedPath, next) {
      if (replaceFailure !== undefined) {
        const failure = replaceFailure;
        replaceFailure = undefined;
        throw failure;
      }
      const row = rows.get(bookId);
      if (row === undefined) {
        throw new NotFoundError("El libro no existe.");
      }
      let currentPath: string | null = null;
      if (row.content !== null) {
        currentPath = row.content.path;
      }
      if (currentPath !== expectedPath) {
        throw new ConflictError(CONTENT_CONFLICT_MESSAGE);
      }
      row.content = { ...next };
      if (replaceAfterCommitFailure !== undefined) {
        const failure = replaceAfterCommitFailure;
        replaceAfterCommitFailure = undefined;
        throw failure;
      }
      return { previousPath: currentPath };
    },
  };
}

export function createFakeActiveDigitalLoans(): FakeActiveDigitalLoans {
  const counts = new Map<Id, number>();
  return {
    setActive(bookId, count) {
      counts.set(bookId, count);
    },
    async countActiveDigitalByBook(bookId) {
      return counts.get(bookId) ?? 0;
    },
  };
}
