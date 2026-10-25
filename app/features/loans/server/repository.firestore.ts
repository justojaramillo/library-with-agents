import { ZodError } from "zod";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/shared/server/collections";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import { LoanSchema, type Loan } from "../schema";
import type { LendOutcome, LoanRepository } from "./repository";

const LoanFieldsSchema = LoanSchema.omit({ id: true });

/** Los documentos se validan al leerlos: Firestore no impone esquema (ADR-0003). */
function toLoan(id: string, fields: DocumentData | undefined): Loan {
  try {
    return { ...LoanFieldsSchema.parse(fields), id };
  } catch (error) {
    if (error instanceof ZodError) {
      // Un documento corrupto es un fallo del servidor, no un dato inválido del cliente: la API responde 500.
      throw new Error(`Documento de préstamo inválido (${id})`);
    }
    throw error;
  }
}

function byDueDate(a: Loan, b: Loan): number {
  const byDue = a.due_at.localeCompare(b.due_at);
  if (byDue !== 0) {
    return byDue;
  }
  const byLoaned = a.loaned_at.localeCompare(b.loaned_at);
  if (byLoaned !== 0) {
    return byLoaned;
  }
  return a.id.localeCompare(b.id);
}

function byLoanDate(a: Loan, b: Loan): number {
  const byDate = a.loaned_at.localeCompare(b.loaned_at);
  if (byDate !== 0) {
    return byDate;
  }
  return a.id.localeCompare(b.id);
}

type Limits = { bookCopies: number; maxActiveForMember: number };

/** Transacción de F5: lee las dos consultas de conteo, decide y crea el préstamo (reintenta si hay choque). */
async function lendInTransaction(db: Firestore, newLoan: Omit<Loan, "id">, limits: Limits): Promise<LendOutcome> {
  const loans = db.collection(COLLECTIONS.loans);
  return db.runTransaction(async (tx) => {
    const memberQuery = loans.where("member_id", "==", newLoan.member_id).where("returned_at", "==", null);
    const bookQuery = loans.where("book_id", "==", newLoan.book_id).where("returned_at", "==", null);
    const [memberSnapshot, bookSnapshot] = await Promise.all([tx.get(memberQuery), tx.get(bookQuery)]);
    const memberLoans = memberSnapshot.docs.map((doc) => toLoan(doc.id, doc.data()));
    if (memberLoans.some((loan) => loan.book_id === newLoan.book_id)) {
      return { ok: false, reason: "ALREADY_HAS_BOOK" };
    }
    if (memberLoans.length >= limits.maxActiveForMember) {
      return { ok: false, reason: "MEMBER_LIMIT" };
    }
    if (bookSnapshot.size >= limits.bookCopies) {
      return { ok: false, reason: "NO_COPIES" };
    }
    const ref = loans.doc();
    tx.create(ref, newLoan);
    return { ok: true, loan: { ...newLoan, id: ref.id } };
  });
}

export function createFirestoreLoanRepository(db: Firestore): LoanRepository {
  const loans = db.collection(COLLECTIONS.loans);
  const activeBy = (field: "book_id" | "member_id", id: string) =>
    loans.where(field, "==", id).where("returned_at", "==", null);

  return {
    async create(newLoan) {
      const ref = await loans.add(newLoan);
      return { ...newLoan, id: ref.id };
    },
    createWithinLimits(newLoan, limits) {
      return lendInTransaction(db, newLoan, limits);
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
        if (loan.returned_at !== null) {
          throw new ConflictError("El préstamo ya fue devuelto");
        }
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
    async listActive() {
      const result = await loans.where("returned_at", "==", null).get();
      return result.docs.map((doc) => toLoan(doc.id, doc.data())).sort(byDueDate);
    },
    async listAll() {
      const result = await loans.get();
      return result.docs.map((doc) => toLoan(doc.id, doc.data())).sort(byLoanDate);
    },
  };
}
