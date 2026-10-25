import { ZodError } from "zod";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { ConflictError } from "@/shared/server/errors";
import { CreateBookInputSchema } from "../schema";
import { filterBooks } from "./book-search";
import type { BookRecord, BookRepository } from "./repository";

const BOOKS_COLLECTION = "books";

/** Los documentos se validan al leerlos: Firestore no impone esquema ni unicidad (ADR-0003). */
function toRecord(id: string, fields: DocumentData | undefined): BookRecord {
  try {
    return { ...CreateBookInputSchema.parse(fields), id };
  } catch (error) {
    if (error instanceof ZodError) {
      // Un documento corrupto es un fallo del servidor, no un dato inválido del cliente: la API responde 500.
      throw new Error(`Documento de libro inválido (${id})`);
    }
    throw error;
  }
}

export function createFirestoreBookRepository(db: Firestore): BookRepository {
  const books = db.collection(BOOKS_COLLECTION);

  return {
    async create(newBook) {
      const ref = books.doc();
      await db.runTransaction(async (tx) => {
        const duplicated = await tx.get(books.where("isbn", "==", newBook.isbn).limit(1));
        if (!duplicated.empty) {
          throw new ConflictError(`Ya existe un libro con ISBN ${newBook.isbn}`);
        }
        tx.create(ref, newBook);
      });
      return { ...newBook, id: ref.id };
    },
    async findById(id) {
      const snapshot = await books.doc(id).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return toRecord(snapshot.id, snapshot.data());
    },
    async findByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const snapshots = await db.getAll(...ids.map((id) => books.doc(id)));
      return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => toRecord(snapshot.id, snapshot.data()));
    },
    async findByIsbn(isbn) {
      const result = await books.where("isbn", "==", isbn).limit(1).get();
      const first = result.docs[0];
      if (!first) {
        return undefined;
      }
      return toRecord(first.id, first.data());
    },
    async search(q, limit) {
      const result = await books.get();
      return filterBooks(
        result.docs.map((doc) => toRecord(doc.id, doc.data())),
        q,
        limit,
      );
    },
  };
}
