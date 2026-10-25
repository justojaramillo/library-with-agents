import { ZodError } from "zod";
import { FieldPath, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/shared/server/collections";
import { NotFoundError } from "@/shared/server/errors";
import { MemberSchema, TeacherRequestSchema, type TeacherRequest } from "../schema";
import { unknownCursorError } from "./member-paging";
import { applyDecision, assertCanCreate, type AccountState } from "./teacher-request-rules";
import type { TeacherRequestRepository } from "./teacher-request-repository";

/** Lo que se guarda en `teacher_requests/{member_id}`: la solicitud sin el id (que es el id del documento). */
const RequestFieldsSchema = TeacherRequestSchema.omit({ member_id: true });

/** Lo único que `decide` lee de la cuenta; los demás campos del documento se ignoran. */
const AccountFieldsSchema = MemberSchema.pick({ role: true, active: true });

/** Valida el documento leído antes de devolverlo: Firestore no impone esquema (ADR-0003). */
function toRequest(id: string, fields: DocumentData | undefined): TeacherRequest {
  try {
    return { member_id: id, ...RequestFieldsSchema.parse(fields) };
  } catch (error) {
    if (error instanceof ZodError) {
      // Un documento corrupto es un fallo del servidor, no un dato inválido del cliente: la API responde 500.
      throw new Error(`Documento de solicitud inválido (${id})`);
    }
    throw error;
  }
}

function toAccount(id: string, fields: DocumentData | undefined): AccountState {
  if (fields === undefined) {
    return undefined;
  }
  try {
    return AccountFieldsSchema.parse(fields);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Documento de cuenta inválido (${id})`);
    }
    throw error;
  }
}

/** Solicitudes en Firestore (`teacher_requests/{member_id}`). Valida con Zod al escribir y al leer. */
export function createFirestoreTeacherRequestRepository(db: Firestore): TeacherRequestRepository {
  const requests = db.collection(COLLECTIONS.teacherRequests);
  const members = db.collection(COLLECTIONS.members);

  return {
    async get(memberId) {
      const snapshot = await requests.doc(memberId).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return toRequest(snapshot.id, snapshot.data());
    },
    async create(request, retryAfter) {
      const { member_id: memberId, ...fields } = TeacherRequestSchema.parse(request);
      const ref = requests.doc(memberId);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (snapshot.exists) {
          assertCanCreate(toRequest(snapshot.id, snapshot.data()), retryAfter);
        }
        tx.set(ref, fields);
      });
      return { member_id: memberId, ...fields };
    },
    async list(status, limit, after) {
      // Necesita el índice compuesto `teacher_requests`: status ASC, requested_at ASC, __name__ ASC.
      const ordered = requests.where("status", "==", status).orderBy("requested_at").orderBy(FieldPath.documentId());
      let query = ordered.limit(limit + 1);
      if (after !== undefined) {
        const cursor = await requests.doc(after).get();
        if (!cursor.exists) {
          throw unknownCursorError();
        }
        query = ordered.startAfter(toRequest(cursor.id, cursor.data()).requested_at, after).limit(limit + 1);
      }
      const result = await query.get();
      return {
        requests: result.docs.slice(0, limit).map((doc) => toRequest(doc.id, doc.data())),
        hasMore: result.docs.length > limit,
      };
    },
    async decide(memberId, decision, actorId, now) {
      const requestRef = requests.doc(memberId);
      const memberRef = members.doc(memberId);
      return db.runTransaction(async (tx) => {
        // Todas las lecturas van antes que las escrituras (regla de las transacciones de Firestore).
        const [requestSnapshot, memberSnapshot] = await Promise.all([tx.get(requestRef), tx.get(memberRef)]);
        if (!requestSnapshot.exists) {
          throw new NotFoundError(`La solicitud de ${memberId} no existe`);
        }
        const current = toRequest(requestSnapshot.id, requestSnapshot.data());
        const account = toAccount(memberId, memberSnapshot.data());
        const updated = applyDecision(current, account, decision, actorId, now);
        tx.set(requestRef, RequestFieldsSchema.parse(updated));
        if (decision.kind === "approve") {
          tx.update(memberRef, { role: "DOCENTE" });
        }
        return updated;
      });
    },
  };
}
