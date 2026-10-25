import { z } from "zod";
import { IdSchema, type Id } from "@/shared/schema";
import { ConflictError } from "@/shared/server/errors";
import { CreateBookInputSchema, type Book, type CreateBookInput } from "../schema";
import type { ActiveLoansReader, BookRecord, BookRepository } from "./repository";

export type BookService = {
  /** F1 · Registrar libro. Lanza ConflictError si el ISBN ya existe. */
  create(input: CreateBookInput): Promise<Book>;
  /** F2 · Buscar por título o autor (parcial, sin mayúsculas). `""` lista todo. `limit` recorta tras ordenar por título. */
  search(q: string, limit?: number): Promise<Book[]>;
  /** Lectura por lote (F34–F35): los libros con esos ids, con `available`, en el orden recibido. Sin repetidos ni inexistentes; máximo 500 ids (si no, error de validación → 400). */
  getMany(ids: Id[]): Promise<Book[]>;
  /** Como `getMany` (mismas validaciones, orden y exclusiones) pero solo `id`, `title` y `author`, sin consultar los préstamos activos. */
  getSummaries(ids: Id[]): Promise<BookSummary[]>;
};

export type BookSummary = Pick<Book, "id" | "title" | "author">;

/** Tope de ids por llamada (el máximo de `getAll` en Firestore). */
const MAX_BATCH_IDS = 500;
const BatchIdsSchema = z.array(IdSchema).max(MAX_BATCH_IDS);

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
    async search(q, limit) {
      const records = await deps.books.search(q.trim(), limit);
      return Promise.all(records.map(toBook));
    },
    async getMany(ids) {
      const unique = [...new Set(BatchIdsSchema.parse(ids))];
      const records = await deps.books.findByIds(unique);
      const books = await Promise.all(records.map(toBook));
      const byId = new Map(books.map((book) => [book.id, book]));
      return unique.flatMap((id) => byId.get(id) ?? []);
    },
    async getSummaries(ids) {
      const unique = [...new Set(BatchIdsSchema.parse(ids))];
      const records = await deps.books.findByIds(unique);
      const byId = new Map(records.map((record) => [record.id, record]));
      return unique.flatMap((id) => {
        const record = byId.get(id);
        if (!record) {
          return [];
        }
        return [{ id: record.id, title: record.title, author: record.author }];
      });
    },
  };
}
