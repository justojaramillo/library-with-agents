import { BORROWER_ROLES, STAFF_ROLES } from "@/shared/schema";
import type { BorrowerRole, Id, Role } from "@/shared/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { LOAN_RULES } from "../schema";
import type { Actor, LendInput, Loan, LoanServicePort, OverdueLoan, ReturnResult } from "../schema";
import { computeDaysLate } from "./fine-strategy";
import type { FineStrategy } from "./fine-strategy";
import type { BookLookup, LoanRepository, MemberLookup } from "./repository";

export type LoanServiceDeps = {
  books: BookLookup;
  members: MemberLookup;
  loans: LoanRepository;
  fine: FineStrategy;
};

const MS_PER_DAY = 86_400_000;

const LEND_CONFLICTS = {
  ALREADY_HAS_BOOK: "La persona ya tiene un ejemplar de este libro en préstamo",
  MEMBER_LIMIT: "La persona alcanzó el máximo de préstamos activos de su rol",
  NO_COPIES: "No hay ejemplares disponibles de este libro",
} as const;

function isBorrowerRole(role: Role): role is BorrowerRole {
  return BORROWER_ROLES.some((borrowerRole) => borrowerRole === role);
}

function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.some((staffRole) => staffRole === role);
}

/** Un prestatario solo puede actuar sobre su propia cuenta; el mensaje no revela si la otra existe. */
function assertCanActOn(actor: Actor, memberId: Id): void {
  if (!isStaffRole(actor.role) && actor.member_id !== memberId) {
    throw new ForbiddenError("Solo puedes consultar o pedir préstamos a tu propio nombre");
  }
}

function isOverdue(loan: Loan, now: Date): boolean {
  return Date.parse(loan.due_at) < now.getTime();
}

type Checked = { role: BorrowerRole; bookCopies: number };

/** Comprobaciones (b) a (g) de F5: devuelve el rol de prestatario y los ejemplares del libro si todo está en orden. */
async function checkCanLend(deps: LoanServiceDeps, input: LendInput, now: Date): Promise<Checked> {
  const member = await deps.members.findById(input.member_id);
  if (!member) {
    throw new NotFoundError("La cuenta no existe");
  }
  const book = await deps.books.findById(input.book_id);
  if (!book) {
    throw new NotFoundError("El libro no existe");
  }
  if (!isBorrowerRole(member.role)) {
    throw new ForbiddenError("Las cuentas de personal no piden libros prestados");
  }
  if (!member.active) {
    throw new ConflictError("La cuenta está inactiva");
  }
  const active = await deps.loans.listActiveByMember(member.id);
  if (active.some((loan) => isOverdue(loan, now))) {
    throw new ConflictError("La persona tiene préstamos vencidos; debe devolverlos antes de pedir otro");
  }
  if (active.some((loan) => loan.book_id === input.book_id)) {
    throw new ConflictError(LEND_CONFLICTS.ALREADY_HAS_BOOK);
  }
  return { role: member.role, bookCopies: book.copies };
}

async function lend(deps: LoanServiceDeps, input: LendInput, actor: Actor, now: Date): Promise<Loan> {
  assertCanActOn(actor, input.member_id);
  const { role, bookCopies } = await checkCanLend(deps, input, now);
  const dueAt = new Date(now.getTime() + LOAN_RULES.loanDaysByRole[role] * MS_PER_DAY);
  const outcome = await deps.loans.createWithinLimits(
    {
      book_id: input.book_id,
      member_id: input.member_id,
      loaned_at: now.toISOString(),
      due_at: dueAt.toISOString(),
      returned_at: null,
    },
    { bookCopies, maxActiveForMember: LOAN_RULES.maxActiveLoansByRole[role] },
  );
  if (!outcome.ok) {
    throw new ConflictError(LEND_CONFLICTS[outcome.reason]);
  }
  return outcome.loan;
}

async function returnLoan(deps: LoanServiceDeps, loanId: Id, actor: Actor, now: Date): Promise<ReturnResult> {
  if (!isStaffRole(actor.role)) {
    throw new ForbiddenError("Solo el personal de la biblioteca puede registrar devoluciones");
  }
  const loan = await deps.loans.findById(loanId);
  if (!loan) {
    throw new NotFoundError("El préstamo no existe");
  }
  if (loan.returned_at !== null) {
    throw new ConflictError("El préstamo ya fue devuelto");
  }
  const returned = await deps.loans.markReturned(loanId, now.toISOString());
  const daysLate = computeDaysLate(loan.due_at, now);
  return { loan: returned, fine_cop: deps.fine.calculate(daysLate) };
}

async function listOverdue(deps: LoanServiceDeps, memberId: Id, actor: Actor, now: Date): Promise<OverdueLoan[]> {
  assertCanActOn(actor, memberId);
  if (!(await deps.members.findById(memberId))) {
    throw new NotFoundError("La cuenta no existe");
  }
  const active = await deps.loans.listActiveByMember(memberId);
  return active
    .filter((loan) => isOverdue(loan, now))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .map((loan) => {
      const daysLate = computeDaysLate(loan.due_at, now);
      return { loan, days_late: daysLate, fine_cop: deps.fine.calculate(daysLate) };
    });
}

/** F5, F6 y F8 · Servicio de préstamos de libros físicos. Las reglas viven solo aquí (spec F5-F8). */
export function createLoanService(deps: LoanServiceDeps): LoanServicePort {
  return {
    lend: (input, actor, now) => lend(deps, input, actor, now),
    returnLoan: (loanId, actor, now) => returnLoan(deps, loanId, actor, now),
    listOverdue: (memberId, actor, now) => listOverdue(deps, memberId, actor, now),
  };
}
