import type { Role } from "@/shared/schema";
import type { Member } from "@/features/accounts/schema";
import type { Book } from "@/features/catalog/schema";
import type { ActiveLoan } from "../schema";

/** Una fila lista para dibujar: el préstamo unido con el título del libro y el nombre de la persona. */
export type LoanRow = {
  loan_id: string;
  book_title: string;
  book_author: string;
  member_name: string;
  member_role: Role | null;
  loaned_at: string;
  due_at: string;
  days_late: number;
  fine_cop: number;
};

type MemberInfo = Pick<Member, "id" | "name" | "role">;
type BookInfo = Pick<Book, "id" | "title" | "author">;

/**
 * Une cada préstamo activo con su libro y su persona (regla 9 de F34). Conserva el orden de entrada.
 * Si el libro o la cuenta ya no existen, la fila lo dice con el id y el préstamo se puede devolver igual.
 */
export function joinLoanRows(active: ActiveLoan[], members: MemberInfo[], books: BookInfo[]): LoanRow[] {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const bookById = new Map(books.map((book) => [book.id, book]));
  return active.map((item) => {
    const member = memberById.get(item.loan.member_id);
    const book = bookById.get(item.loan.book_id);
    return {
      loan_id: item.loan.id,
      book_title: book?.title ?? `Libro no disponible (${item.loan.book_id})`,
      book_author: book?.author ?? "Autor no disponible",
      member_name: member?.name ?? `Cuenta no disponible (${item.loan.member_id})`,
      member_role: member?.role ?? null,
      loaned_at: item.loan.loaned_at,
      due_at: item.loan.due_at,
      days_late: item.days_late,
      fine_cop: item.fine_cop,
    };
  });
}
