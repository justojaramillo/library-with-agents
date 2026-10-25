import type { Id } from "@/shared/schema";
import { ConflictError } from "@/shared/server/errors";
import { filterBooks } from "./book-search";
import type { BookRecord, BookRepository } from "./repository";

class MemoryBooks implements BookRepository {
  private rows: BookRecord[] = [];
  private lastId = 0;

  async create(newBook: Omit<BookRecord, "id">): Promise<BookRecord> {
    if (this.rows.some((book) => book.isbn === newBook.isbn)) {
      throw new ConflictError(`Ya existe un libro con ISBN ${newBook.isbn}`);
    }
    this.lastId += 1;
    const row = { ...newBook, id: String(this.lastId) };
    this.rows.push(row);
    return { ...row };
  }

  async findById(id: Id) {
    const row = this.rows.find((book) => book.id === id);
    return row && { ...row };
  }

  async findByIds(ids: Id[]) {
    const wanted = new Set(ids);
    return this.rows.filter((book) => wanted.has(book.id)).map((book) => ({ ...book }));
  }

  async findByIsbn(isbn: string) {
    const row = this.rows.find((book) => book.isbn === isbn);
    return row && { ...row };
  }

  async search(q: string, limit?: number) {
    return filterBooks(
      this.rows.map((book) => ({ ...book })),
      q,
      limit,
    );
  }
}

/** Repositorio en memoria: rápido y sin red; se usa en las pruebas unitarias. */
export function createMemoryBookRepository(): BookRepository {
  return new MemoryBooks();
}
