import type { Id, Role } from "@/shared/schema";
import type { Loan } from "../schema";

export interface LoanRepository {
  create(newLoan: Omit<Loan, "id">): Promise<Loan>;
  findById(id: Id): Promise<Loan | undefined>;
  /** Marca como devuelto. Devuelve el préstamo actualizado. Lanza NotFoundError si no existe. */
  markReturned(id: Id, returnedAt: string): Promise<Loan>;
  countActiveByMember(memberId: Id): Promise<number>;
  countActiveByBook(bookId: Id): Promise<number>;
  /** Ordenados por fecha de vencimiento. */
  listActiveByMember(memberId: Id): Promise<Loan[]>;
  /** Para el panel (F9). */
  listAll(): Promise<Loan[]>;
}

/**
 * Puertos que los préstamos necesitan de otras features. Los declara `loans` (el consumidor) con lo
 * mínimo que usa; los repositorios de `catalog` y `accounts` los cumplen por estructura y se conectan
 * en `features/container.ts`.
 */
export interface BookLookup {
  findById(id: Id): Promise<{ id: Id; copies: number } | undefined>;
}

export interface MemberLookup {
  findById(id: Id): Promise<{ id: Id; role: Role; active: boolean } | undefined>;
}
