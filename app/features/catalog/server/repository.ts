import type { Id } from "@/shared/schema";

/** Registro tal como se guarda. El servicio lo transforma en el tipo `Book` de `../schema`. */
export type BookRecord = { id: Id; isbn: string; title: string; author: string; copies: number };

export interface BookRepository {
  /** Guarda el libro. Lanza ConflictError si el ISBN ya existe. */
  create(newBook: Omit<BookRecord, "id">): Promise<BookRecord>;
  findById(id: Id): Promise<BookRecord | undefined>;
  findByIsbn(isbn: string): Promise<BookRecord | undefined>;
  /** Los libros con esos ids (ya sin repetidos, hasta 500). Los inexistentes se omiten; el orden no está garantizado. */
  findByIds(ids: Id[]): Promise<BookRecord[]>;
  /** Coincidencia parcial en título o autor, sin distinguir mayúsculas, ordenada por título. `""` lista todo. Con `limit`, recorta tras ordenar. */
  search(q: string, limit?: number): Promise<BookRecord[]>;
}

/**
 * Puerto que el catálogo necesita de los préstamos para calcular `available`.
 * Lo declara el catálogo (el consumidor) y lo implementa el repositorio de `loans`;
 * se conectan en `features/container.ts`, sin que una feature importe a la otra.
 */
export interface ActiveLoansReader {
  countActiveByBook(bookId: Id): Promise<number>;
}
