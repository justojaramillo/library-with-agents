import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { NotFoundError } from "@/shared/server/errors";
import { LoanSchema, type Loan } from "../schema";
import type { LoanRepository } from "./repository";

const LOANS_COLLECTION = "loans";
const LoanFieldsSchema = LoanSchema.omit({ id: true });

/** Los documentos se validan al leerlos: Firestore no impone esquema (ADR-0003). */
function toLoan(id: string, fields: DocumentData | undefined): Loan {
  return { ...LoanFieldsSchema.parse(fields), id };
}

function byDueDate(a: Loan, b: Loan): number {
  return a.due_at.localeCompare(b.due_at);
}

function byLoanDate(a: Loan, b: Loan): number {
  const byDate = a.loaned_at.localeCompare(b.loaned_at);
  if (byDate !== 0) {
    return byDate;
  }
  return a.id.localeCompare(b.id);
}

export function createFirestoreLoanRepository(db: Firestore): LoanRepository {
  const loans = db.collection(LOANS_COLLECTION);
  const activeBy = (field: "book_id" | "member_id", id: string) =>
    loans.where(field, "==", id).where("returned_at", "==", null);

  return {
    async create(newLoan) {
      const ref = await loans.add(newLoan);
      return { ...newLoan, id: ref.id };
    },
    async findById(id) {
      const snapshot = await loans.doc(id).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return toLoan(snapshot.id, snapshot.data());
    },
    async markReturned(id, returnedAt) {
      const ref = loans.doc(id);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          throw new NotFoundError(`El préstamo ${id} no existe`);
        }
        const loan = toLoan(snapshot.id, snapshot.data());
        tx.update(ref, { returned_at: returnedAt });
        return { ...loan, returned_at: returnedAt };
      });
    },
    async countActiveByMember(memberId) {
      const result = await activeBy("member_id", memberId).count().get();
      return result.data().count;
    },
    async countActiveByBook(bookId) {
      const result = await activeBy("book_id", bookId).count().get();
      return result.data().count;
    },
    async listActiveByMember(memberId) {
      const result = await activeBy("member_id", memberId).get();
      return result.docs.map((doc) => toLoan(doc.id, doc.data())).sort(byDueDate);
    },
    async listAll() {
      const result = await loans.get();
      return result.docs.map((doc) => toLoan(doc.id, doc.data())).sort(byLoanDate);
    },
  };
}
