import type { Id } from "@/shared/schema";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import type { Loan } from "../schema";
import type { LendOutcome, LoanRepository } from "./repository";

class MemoryLoans implements LoanRepository {
  private rows: Loan[] = [];
  private lastId = 0;

  async create(newLoan: Omit<Loan, "id">): Promise<Loan> {
    this.lastId += 1;
    const row = { ...newLoan, id: String(this.lastId) };
    this.rows.push(row);
    return { ...row };
  }

  /** Sin `await` entre comprobar y crear: en un solo hilo la operación es atómica. */
  async createWithinLimits(
    newLoan: Omit<Loan, "id">,
    limits: { bookCopies: number; maxActiveForMember: number },
  ): Promise<LendOutcome> {
    const memberActive = this.rows.filter((loan) => loan.member_id === newLoan.member_id && loan.returned_at === null);
    if (memberActive.some((loan) => loan.book_id === newLoan.book_id)) {
      return { ok: false, reason: "ALREADY_HAS_BOOK" };
    }
    if (memberActive.length >= limits.maxActiveForMember) {
      return { ok: false, reason: "MEMBER_LIMIT" };
    }
    const bookActive = this.rows.filter((loan) => loan.book_id === newLoan.book_id && loan.returned_at === null);
    if (bookActive.length >= limits.bookCopies) {
      return { ok: false, reason: "NO_COPIES" };
    }
    this.lastId += 1;
    const row = { ...newLoan, id: String(this.lastId) };
    this.rows.push(row);
    return { ok: true, loan: { ...row } };
  }

  async findById(id: Id) {
    const row = this.rows.find((loan) => loan.id === id);
    return row && { ...row };
  }

  async markReturned(id: Id, returnedAt: string): Promise<Loan> {
    const row = this.rows.find((loan) => loan.id === id);
    if (!row) {
      throw new NotFoundError(`El préstamo ${id} no existe`);
    }
    if (row.returned_at !== null) {
      throw new ConflictError("El préstamo ya fue devuelto");
    }
    row.returned_at = returnedAt;
    return { ...row };
  }

  async countActiveByMember(memberId: Id) {
    return this.rows.filter((loan) => loan.member_id === memberId && loan.returned_at === null).length;
  }

  async countActiveByBook(bookId: Id) {
    return this.rows.filter((loan) => loan.book_id === bookId && loan.returned_at === null).length;
  }

  async listActiveByMember(memberId: Id) {
    return this.rows
      .filter((loan) => loan.member_id === memberId && loan.returned_at === null)
      .map((loan) => ({ ...loan }))
      .sort((a, b) => a.due_at.localeCompare(b.due_at));
  }

  async listAll() {
    return this.rows.map((loan) => ({ ...loan }));
  }
}

/** Repositorio en memoria: rápido y sin red; se usa en las pruebas unitarias. */
export function createMemoryLoanRepository(): LoanRepository {
  return new MemoryLoans();
}
