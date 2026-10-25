import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/shared/server/collections";
import { ConflictError } from "@/shared/server/errors";
import { MemberSchema } from "../schema";
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

/** Valida el documento leído (rol incluido) antes de devolverlo. */
function toRecord(snapshot: DocumentSnapshot): MemberRecord {
  return { id: snapshot.id, ...MemberDocumentSchema.parse(snapshot.data()) };
}

/** Cuentas en Firestore (`members/{uid}`). Valida con Zod al escribir y al leer. */
export function createFirestoreMemberRepository(db: Firestore): MemberRepository {
  const members = db.collection(COLLECTIONS.members);

  return {
    async create(record) {
      const valid = MemberSchema.parse(record);
      const { id, ...fields } = valid;
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
    async list() {
      const result = await members.get();
      return result.docs.map(toRecord);
    },
  };
}
