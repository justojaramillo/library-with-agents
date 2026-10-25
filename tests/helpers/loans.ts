import type { MemberRecord } from "@/features/accounts/server/repository";
import type { Actor, Loan } from "@/features/loans/schema";
import { createDailyFineStrategy, type FineStrategy } from "@/features/loans/server/fine-strategy";
import { createLoanService } from "@/features/loans/server/loan-service";
import type { Role } from "@/shared/schema";
import { aBook, makeWorld } from "./factories";

/** Un día en milisegundos: la spec F5–F8 no usa calendario ni zona horaria. */
export const DAY_MS = 86_400_000;
/** Instante fijo de las pruebas (el reloj real nunca se usa). */
export const NOW = new Date("2026-01-10T10:00:00.000Z");

/** ISO 8601 UTC de `base` movido `ms` milisegundos. */
export function isoPlus(base: Date | string, ms: number): string {
  return new Date(new Date(base).getTime() + ms).toISOString();
}

/** El actor que la sesión entregaría para esa cuenta. */
export function actorOf(member: { id: string; role: Role }): Actor {
  return { member_id: member.id, role: member.role };
}

type LoanOverrides = Partial<Omit<Loan, "id">>;

let seq = 0;

/** Mundo de préstamos: repositorios en memoria + servicio real; cada prueba empieza vacía. */
export function makeLoanWorld(options: { fine?: FineStrategy } = {}) {
  const world = makeWorld();
  const { repos } = world;
  const service = createLoanService({
    books: repos.books,
    members: repos.members,
    loans: repos.loans,
    fine: options.fine ?? createDailyFineStrategy(),
  });

  async function addMember(role: Role, over: Partial<MemberRecord> = {}): Promise<MemberRecord> {
    seq += 1;
    return repos.members.create({
      id: `m-${seq}`,
      name: `Persona ${seq}`,
      email: `persona${seq}@example.com`,
      role,
      active: true,
      ...over,
    });
  }

  async function addBook(copies = 1) {
    return repos.books.create(aBook({ copies }));
  }

  /** Préstamo activo sembrado directo en el repositorio (vence 5 días después de `NOW` salvo que se indique). */
  async function seedLoan(memberId: string, bookId: string, over: LoanOverrides = {}): Promise<Loan> {
    return repos.loans.create({
      book_id: bookId,
      member_id: memberId,
      loaned_at: isoPlus(NOW, -DAY_MS),
      due_at: isoPlus(NOW, 5 * DAY_MS),
      returned_at: null,
      ...over,
    });
  }

  /** `count` préstamos activos y vigentes de libros distintos para esa persona. */
  async function seedActiveLoans(memberId: string, count: number): Promise<Loan[]> {
    const created: Loan[] = [];
    for (let i = 0; i < count; i += 1) {
      const book = await addBook(2);
      created.push(await seedLoan(memberId, book.id));
    }
    return created;
  }

  return { ...world, service, addMember, addBook, seedLoan, seedActiveLoans };
}
export type LoanWorld = ReturnType<typeof makeLoanWorld>;
