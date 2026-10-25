import type { LoanServicePort } from "../schema";
import type { FineStrategy } from "./fine-strategy";
import type { BookLookup, LoanRepository, MemberLookup } from "./repository";

export type LoanServiceDeps = {
  books: BookLookup;
  members: MemberLookup;
  loans: LoanRepository;
  fine: FineStrategy;
};

/**
 * TODO F5, F6, F8 — implementar `LoanServicePort` (ver `../schema.ts` y `docs/features.md`).
 * Las reglas de negocio están en `LOAN_RULES`. Las especificaciones se escriben en `docs/specs/`.
 */
export function createLoanService(deps: LoanServiceDeps): LoanServicePort {
  void deps;
  throw new Error("NOT_IMPLEMENTED: F5/F6/F8 · createLoanService");
}
