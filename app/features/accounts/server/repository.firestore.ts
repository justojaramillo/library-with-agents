import { ZodError } from "zod";
import { FieldPath, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/shared/server/collections";
import { ConflictError } from "@/shared/server/errors";
import { MemberSchema } from "../schema";
import { unknownCursorError } from "./member-paging";
import { buildSearchKeys, longestQueryWord, matchesMemberQuery, passesLendable, sortAndLimit } from "./member-search";
import type { MemberRecord, MemberRepository } from "./repository";

/** Documento fijo que garantiza el ADMINISTRADOR único: `create()` falla si ya existe. */
const ADMIN_DOCUMENT = "admin";

/** Lo que se guarda en `members/{uid}`: la cuenta sin el id (que es el id del documento). */
const MemberDocumentSchema = MemberSchema.omit({ id: true });

/** `true` si el error es ALREADY_EXISTS de Firestore (código gRPC 6). */
function isAlreadyExists<T>(error: T): boolean {
  if (error instanceof Error && error.message.includes("ALREADY_EXISTS")) {
    return true;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code === 6 || error.code === "already-exists";
  }
  return false;
}

function rethrowAsConflict<T>(error: T): never {
  if (isAlreadyExists(error)) {
    throw new ConflictError("Ya existe una cuenta con ese id o un administrador");
  }
  throw error;
}

/** B4 · Tope de documentos que una búsqueda lee de Firestore. */
const SEARCH_READ_LIMIT = 200;

/** Valida el documento leído (rol incluido) antes de devolverlo. */
function toRecord(snapshot: DocumentSnapshot): MemberRecord {
  try {
    return { id: snapshot.id, ...MemberDocumentSchema.parse(snapshot.data()) };
  } catch (error) {
    if (error instanceof ZodError) {
      // Un documento corrupto es un fallo del servidor, no un dato inválido del cliente: la API responde 500.
      throw new Error(`Documento de cuenta inválido (${snapshot.id})`);
    }
    throw error;
  }
}

/** Cuentas en Firestore (`members/{uid}`). Valida con Zod al escribir y al leer. */
export function createFirestoreMemberRepository(db: Firestore): MemberRepository {
  const members = db.collection(COLLECTIONS.members);

  return {
    async create(record) {
      const valid = MemberSchema.parse(record);
      const { id, ...publicFields } = valid;
      // `search_keys` es un detalle interno del repositorio (B4): se guarda pero nunca sale en `MemberRecord`.
      const fields = { ...publicFields, search_keys: buildSearchKeys(valid.name, valid.email) };
      const ref = members.doc(id);
      try {
        if (valid.role === "ADMINISTRADOR") {
          await db.runTransaction(async (transaction) => {
            transaction.create(db.collection(COLLECTIONS.meta).doc(ADMIN_DOCUMENT), { member_id: id });
            transaction.create(ref, fields);
          });
        } else {
          await ref.create(fields);
        }
      } catch (error) {
        return rethrowAsConflict(error);
      }
      return valid;
    },
    async findById(id) {
      const snapshot = await members.doc(id).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return toRecord(snapshot);
    },
    async findByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const snapshots = await db.getAll(...ids.map((id) => members.doc(id)));
      return snapshots.filter((snapshot) => snapshot.exists).map(toRecord);
    },
    async findByEmail(email) {
      const result = await members.where("email", "==", email).limit(1).get();
      const first = result.docs.at(0);
      if (!first) {
        return undefined;
      }
      return toRecord(first);
    },
    async existsWithRole(role) {
      const result = await members.where("role", "==", role).limit(1).get();
      return !result.empty;
    },
    async list(limit, after) {
      const ordered = members.orderBy("name").orderBy(FieldPath.documentId());
      let query = ordered.limit(limit + 1);
      if (after !== undefined) {
        const cursor = await members.doc(after).get();
        if (!cursor.exists) {
          throw unknownCursorError();
        }
        query = ordered.startAfter(toRecord(cursor).name, after).limit(limit + 1);
      }
      const result = await query.get();
      return { members: result.docs.slice(0, limit).map(toRecord), hasMore: result.docs.length > limit };
    },
    async search(q, limit, lendable) {
      const key = longestQueryWord(q);
      if (key.length < 2) {
        return { members: [], truncated: false };
      }
      const result = await members.where("search_keys", "array-contains", key).limit(SEARCH_READ_LIMIT).get();
      const found = result.docs
        .map(toRecord)
        .filter((record) => matchesMemberQuery(record, q) && passesLendable(record, lendable));
      return { members: sortAndLimit(found, limit), truncated: result.docs.length >= SEARCH_READ_LIMIT };
    },
  };
}
