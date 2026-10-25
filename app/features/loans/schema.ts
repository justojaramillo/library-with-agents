import { z } from "zod";
import { IdSchema } from "@/shared/schema";
import type { BorrowerRole, Id, Role } from "@/shared/schema";

/**
 * CONTRATO de préstamos (F5, F6, F7, F8).
 *
 * Este archivo es el acuerdo entre agentes: el backend lo implementa, el frontend lo consume
 * y las pruebas se escriben contra él. Si hay que cambiarlo, se pide al orquestador
 * (nadie lo modifica por su cuenta).
 */

/** Reglas de negocio con nombre: viven aquí para que todos las lean igual. */
export const LOAN_RULES = {
  maxActiveLoansPerMember: 3,
  /** Plazo en días según el rol de quien pide prestado (ADR-0004). */
  loanDaysByRole: { EXTERNO: 15, ESTUDIANTE: 20, DOCENTE: 30 } satisfies Record<BorrowerRole, number>,
  /** F7 · multa por defecto: COP por día de retraso y tope. */
  fineCopPerDay: 500,
  fineCapCop: 20_000,
} as const;

export const LoanSchema = z.object({
  id: IdSchema,
  book_id: IdSchema,
  member_id: IdSchema,
  /** Fechas ISO 8601 en UTC. */
  loaned_at: z.string(),
  due_at: z.string(),
  returned_at: z.string().nullable(),
});
export type Loan = z.infer<typeof LoanSchema>;

/** F5 · Prestar libro — entrada. */
export const LendInputSchema = z.object({
  member_id: IdSchema,
  book_id: IdSchema,
});
export type LendInput = z.infer<typeof LendInputSchema>;

/** F6 · Devolver libro: devuelve el préstamo cerrado y la multa (0 si no hay retraso). */
export const ReturnResultSchema = z.object({
  loan: LoanSchema,
  fine_cop: z.number().int().min(0),
});
export type ReturnResult = z.infer<typeof ReturnResultSchema>;

/** F8 · Préstamo vencido de una persona, con su multa acumulada a la fecha. */
export const OverdueLoanSchema = z.object({
  loan: LoanSchema,
  days_late: z.number().int().min(1),
  fine_cop: z.number().int().min(0),
});
export type OverdueLoan = z.infer<typeof OverdueLoanSchema>;

/** Quién está pidiendo la operación (viene de la sesión, nunca del cuerpo de la petición). */
export type Actor = { member_id: Id; role: Role };

/**
 * Puerto del servicio de préstamos. El tiempo se inyecta (`now`) para que las pruebas
 * no dependan del reloj real.
 *
 * Errores esperados (clases en `app/shared/server/errors.ts`):
 *  - lend:   NotFoundError, ConflictError (sin ejemplares / límite de préstamos / cuenta inactiva / deuda pendiente),
 *            ForbiddenError (el rol no puede pedir prestado, o un prestatario pide a nombre de otra persona)
 *  - return: NotFoundError, ConflictError (ya devuelto)
 *  - listOverdue: NotFoundError (cuenta), ForbiddenError (un prestatario pide los de otra persona)
 */
export interface LoanServicePort {
  lend(input: LendInput, now: Date): Promise<Loan>;
  returnLoan(loanId: Id, now: Date): Promise<ReturnResult>;
  listOverdue(memberId: Id, actor: Actor, now: Date): Promise<OverdueLoan[]>;
}
