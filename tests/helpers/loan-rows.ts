import type { LoanRow } from "@/features/loans/ui/loan-rows";

let seq = 0;

/** Patrón Factory: una fila de préstamo lista para dibujar, en plazo y con datos distinguibles. */
export function aLoanRow(over: Partial<LoanRow> = {}): LoanRow {
  seq += 1;
  return {
    loan_id: `loan-${seq}`,
    book_title: `Título ${seq}`,
    book_author: `Autora ${seq}`,
    member_name: `Persona ${seq}`,
    member_role: "ESTUDIANTE",
    loaned_at: "2026-01-10T15:00:00.000Z",
    due_at: "2026-01-30T20:45:00.000Z",
    days_late: 0,
    fine_cop: 0,
    ...over,
  };
}
