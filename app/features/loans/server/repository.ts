import type { Id, Role } from "@/shared/schema";
import type { Loan } from "../schema";

/** Resultado de `createWithinLimits`: el préstamo creado o la primera regla que no se cumplió. */
export type LendOutcome =
  | { ok: true; loan: Loan }
  | { ok: false; reason: "ALREADY_HAS_BOOK" | "MEMBER_LIMIT" | "NO_COPIES" };

export interface LoanRepository {
  create(newLoan: Omit<Loan, "id">): Promise<Loan>;
  /**
   * Crea el préstamo solo si se cumplen, en este orden y en una sola operación atómica:
   * la persona no tiene ya un ejemplar activo de ese libro (`ALREADY_HAS_BOOK`), sus préstamos activos
   * son menos que `maxActiveForMember` (`MEMBER_LIMIT`) y los activos del libro son menos que
   * `bookCopies` (`NO_COPIES`). Evita que dos peticiones simultáneas pasen la misma comprobación.
   */
  createWithinLimits(
    newLoan: Omit<Loan, "id">,
    limits: { bookCopies: number; maxActiveForMember: number },
  ): Promise<LendOutcome>;
  findById(id: Id): Promise<Loan | undefined>;
  /** Marca como devuelto. Devuelve el préstamo actualizado. Lanza NotFoundError si no existe y ConflictError si ya estaba devuelto (comprobado de forma atómica). */
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
