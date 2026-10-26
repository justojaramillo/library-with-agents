import { z, ZodError } from "zod";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/shared/server/collections";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import { DIGITAL_RULES } from "../schema";
import { CONTENT_CONFLICT_MESSAGE, type DigitalBookRecord, type DigitalBookRepository } from "./repository";

/**
 * Lo que el lector lee de `books/{id}`; el resto de campos del libro se ignora. Un libro sin `digital_copies`
 * vale 0 copias (F27, «Qué hay hoy»). Los tres campos `content_*` van juntos o no va ninguno.
 */
const DigitalFieldsSchema = z.object({
  title: z.string(),
  digital_copies: z.number().int().min(0).max(DIGITAL_RULES.maxCopies).default(0),
  content_path: z.string().min(1).nullish(),
  content_bytes: z.number().int().min(0).nullish(),
  content_updated_at: z.string().min(1).nullish(),
});

type DigitalFields = z.infer<typeof DigitalFieldsSchema>;

function toContent(fields: DigitalFields, id: string): DigitalBookRecord["content"] {
  const { content_path: path, content_bytes: bytes, content_updated_at: updatedAt } = fields;
  if (path == null && bytes == null && updatedAt == null) {
    return null;
  }
  if (path == null || bytes == null || updatedAt == null) {
    throw new Error(`Documento de libro digital inválido (${id})`);
  }
  return { path, bytes, updatedAt };
}

/** Valida el documento al leerlo: Firestore no impone esquema (ADR-0003). Un documento corrupto da 500 sin detalle. */
function toRecord(id: string, fields: DocumentData | undefined): DigitalBookRecord {
  try {
    const parsed = DigitalFieldsSchema.parse(fields);
    return { id, title: parsed.title, digital_copies: parsed.digital_copies, content: toContent(parsed, id) };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Documento de libro digital inválido (${id})`);
    }
    throw error;
  }
}

/** Campos digitales de `books/{id}`. Las escrituras son `update` de los campos propios: el resto del libro no se toca. */
export function createFirestoreDigitalBookRepository(db: Firestore): DigitalBookRepository {
  const books = db.collection(COLLECTIONS.books);

  return {
    async find(bookId) {
      const snapshot = await books.doc(bookId).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return toRecord(snapshot.id, snapshot.data());
    },
    async setCopies(bookId, copies) {
      const ref = books.doc(bookId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          return undefined;
        }
        const current = toRecord(snapshot.id, snapshot.data());
        tx.update(ref, { digital_copies: copies });
        return { ...current, digital_copies: copies };
      });
    },
    async replaceContent(bookId, expectedPath, next) {
      const ref = books.doc(bookId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          throw new NotFoundError("El libro no existe.");
        }
        const current = toRecord(snapshot.id, snapshot.data());
        let previousPath: string | null = null;
        if (current.content !== null) {
          previousPath = current.content.path;
        }
        if (previousPath !== expectedPath) {
          throw new ConflictError(CONTENT_CONFLICT_MESSAGE);
        }
        tx.update(ref, {
          content_path: next.path,
          content_bytes: next.bytes,
          content_updated_at: next.updatedAt,
        });
        return { previousPath };
      });
    },
  };
}
