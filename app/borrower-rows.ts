import { getContainer } from "@/features/container";
import { joinLoanRows, type LoanRow } from "@/features/loans/ui/loan-rows";
import type { ActiveLoan } from "@/features/loans/schema";

/** Filas listas para pintar (F35). Solo se leen los libros de esos préstamos, por id. */
export async function loadBorrowerRows(items: ActiveLoan[]): Promise<LoanRow[]> {
  if (items.length === 0) {
    return [];
  }
  const ids = [...new Set(items.map((item) => item.loan.book_id))];
  const books = await getContainer().books.getSummaries(ids);
  return joinLoanRows(items, [], books);
}
