import { ConflictError } from "@/shared/server/errors";
import { CreateBookInputSchema, type Book, type CreateBookInput } from "../schema";
import type { ActiveLoansReader, BookRecord, BookRepository } from "./repository";

export type BookService = {
  /** F1 · Registrar libro. Lanza ConflictError si el ISBN ya existe. */
  create(input: CreateBookInput): Promise<Book>;
  /** F2 · Buscar por título o autor (parcial, sin mayúsculas). `""` lista todo. */
  search(q: string): Promise<Book[]>;
};

export function createBookService(deps: { books: BookRepository; loans: ActiveLoansReader }): BookService {
  const toBook = async (record: BookRecord): Promise<Book> => {
    const active = await deps.loans.countActiveByBook(record.id);
    return { ...record, available: Math.max(0, record.copies - active) };
  };

  return {
    async create(input) {
      const newBook = CreateBookInputSchema.parse(input);
      if (await deps.books.findByIsbn(newBook.isbn)) {
        throw new ConflictError(`Ya existe un libro con ISBN ${newBook.isbn}`);
      }
      return toBook(await deps.books.create(newBook));
    },
    async search(q) {
      const records = await deps.books.search(q.trim());
      return Promise.all(records.map(toBook));
    },
  };
}
