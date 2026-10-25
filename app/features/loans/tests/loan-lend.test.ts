import { describe, expect, it } from "vitest";
import { BORROWER_ROLES, type BorrowerRole } from "@/shared/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { actorOf, DAY_MS, isoPlus, makeLoanWorld, NOW } from "@/tests/helpers/loans";
import { LOAN_RULES } from "../schema";
import { createDailyFineStrategy } from "../server/fine-strategy";
import { createLoanService } from "../server/loan-service";
import { createMemoryLoanRepository } from "../server/repository.memory";

const EXPECTED_DAYS: Record<BorrowerRole, number> = { EXTERNO: 15, ESTUDIANTE: 20, DOCENTE: 30 };
const EXPECTED_CAP: Record<BorrowerRole, number> = { EXTERNO: 3, ESTUDIANTE: 3, DOCENTE: 5 };

describe("F5 · prestar: caso feliz y plazo por rol", () => {
  it("presta a un estudiante: vence 20 días después y queda sin devolver", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);

    const loan = await w.service.lend({ member_id: student.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(typeof loan.id).toBe("string");
    expect(loan.id.length).toBeGreaterThan(0);
    expect(loan.member_id).toBe(student.id);
    expect(loan.book_id).toBe(book.id);
    expect(loan.loaned_at).toBe("2026-01-10T10:00:00.000Z");
    expect(loan.due_at).toBe("2026-01-30T10:00:00.000Z");
    expect(loan.returned_at).toBeNull();
  });

  it("el plazo del contrato coincide con la spec (15, 20 y 30 días)", () => {
    expect(LOAN_RULES.loanDaysByRole).toEqual(EXPECTED_DAYS);
  });

  it.each(BORROWER_ROLES)("presta a un %s con el plazo de su rol", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember(role);
    const book = await w.addBook(1);

    const loan = await w.service.lend({ member_id: borrower.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(loan.due_at).toBe(isoPlus(NOW, EXPECTED_DAYS[role] * DAY_MS));
  });

  it("deja el préstamo guardado y cuenta como activo", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember("EXTERNO");
    const book = await w.addBook(2);

    const loan = await w.service.lend({ member_id: borrower.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(await w.repos.loans.findById(loan.id)).toEqual(loan);
    expect(await w.repos.loans.countActiveByMember(borrower.id)).toBe(1);
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(1);
  });

  it("el ADMINISTRADOR también puede prestar a cualquier prestatario", async () => {
    const w = makeLoanWorld();
    const admin = await w.addMember("ADMINISTRADOR");
    const teacher = await w.addMember("DOCENTE");
    const book = await w.addBook(1);

    const loan = await w.service.lend({ member_id: teacher.id, book_id: book.id }, actorOf(admin), NOW);

    expect(loan.member_id).toBe(teacher.id);
  });

  it.each(BORROWER_ROLES)("un %s puede pedir prestado a su propio nombre", async (role) => {
    const w = makeLoanWorld();
    const borrower = await w.addMember(role);
    const book = await w.addBook(1);

    const loan = await w.service.lend({ member_id: borrower.id, book_id: book.id }, actorOf(borrower), NOW);

    expect(loan.member_id).toBe(borrower.id);
    expect(loan.due_at).toBe(isoPlus(NOW, EXPECTED_DAYS[role] * DAY_MS));
  });

  it("al cambiar de ESTUDIANTE a DOCENTE el préstamo anterior conserva su plazo y los nuevos usan 30 días", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    let currentRole: "ESTUDIANTE" | "DOCENTE" = "ESTUDIANTE";
    const memberLookup = {
      findById: async (id: string) => ({ id, role: currentRole, active: true }),
    };
    const service = createLoanService({
      books: w.repos.books,
      members: memberLookup,
      loans: w.repos.loans,
      fine: createDailyFineStrategy(),
    });
    const first = await w.addBook(1);
    const second = await w.addBook(1);

    const before = await service.lend({ member_id: "persona-x", book_id: first.id }, actorOf(librarian), NOW);
    currentRole = "DOCENTE";
    const after = await service.lend({ member_id: "persona-x", book_id: second.id }, actorOf(librarian), NOW);

    expect(before.due_at).toBe(isoPlus(NOW, 20 * DAY_MS));
    expect((await w.repos.loans.findById(before.id))?.due_at).toBe(isoPlus(NOW, 20 * DAY_MS));
    expect(after.due_at).toBe(isoPlus(NOW, 30 * DAY_MS));
  });
});

describe("F5 · prestar: autorización previa", () => {
  it("un prestatario no puede pedir a nombre de otra persona que existe", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);

    await expect(w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(ana), NOW)).rejects.toThrow(
      ForbiddenError,
    );
    expect(await w.repos.loans.listAll()).toHaveLength(0);
  });

  it("pedir a nombre de alguien inexistente o existente da el mismo ForbiddenError con el mismo mensaje", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("DOCENTE");
    const book = await w.addBook(1);

    const existing = await w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(ana), NOW).then(
      () => new Error("no falló"),
      (error: Error) => error,
    );
    const missing = await w.service.lend({ member_id: "no-existe", book_id: book.id }, actorOf(ana), NOW).then(
      () => new Error("no falló"),
      (error: Error) => error,
    );

    expect(existing).toBeInstanceOf(ForbiddenError);
    expect(missing).toBeInstanceOf(ForbiddenError);
    expect(missing.message).toBe(existing.message);
  });

  it("la autorización previa ocurre antes de consultar la cuenta o el libro", async () => {
    let calls = 0;
    const service = createLoanService({
      books: {
        findById: async () => {
          calls += 1;
          return { id: "b1", copies: 1 };
        },
      },
      members: {
        findById: async (id) => {
          calls += 1;
          return { id, role: "ESTUDIANTE", active: true };
        },
      },
      loans: createMemoryLoanRepository(),
      fine: createDailyFineStrategy(),
    });

    await expect(
      service.lend({ member_id: "otra", book_id: "b1" }, { member_id: "yo", role: "ESTUDIANTE" }, NOW),
    ).rejects.toThrow(ForbiddenError);
    expect(calls).toBe(0);
  });
});

describe("F5 · prestar: la cuenta y el libro deben existir y ser válidos", () => {
  it("el personal presta con un member_id inexistente: NotFoundError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const book = await w.addBook(1);

    await expect(w.service.lend({ member_id: "no-existe", book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("el personal presta con un book_id inexistente: NotFoundError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");

    await expect(
      w.service.lend({ member_id: student.id, book_id: "no-existe" }, actorOf(librarian), NOW),
    ).rejects.toThrow(NotFoundError);
  });

  it("un prestatario con un book_id inexistente recibe NotFoundError", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");

    await expect(
      w.service.lend({ member_id: student.id, book_id: "no-existe" }, actorOf(student), NOW),
    ).rejects.toThrow(NotFoundError);
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] as const)("no se presta a una cuenta de personal (%s): ForbiddenError", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const target = await w.addMember(role);
    const book = await w.addBook(1);

    await expect(w.service.lend({ member_id: target.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ForbiddenError,
    );
    expect(await w.repos.loans.listAll()).toHaveLength(0);
  });

  it("el personal no pide prestado con su cuenta de trabajo, ni a su propio nombre", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const book = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: librarian.id, book_id: book.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  it("el orden fijo: la cuenta de personal con libro inexistente da NotFoundError (libro antes que rol)", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const other = await w.addMember("BIBLIOTECARIO");

    await expect(
      w.service.lend({ member_id: other.id, book_id: "no-existe" }, actorOf(librarian), NOW),
    ).rejects.toThrow(NotFoundError);
  });

  it("el orden fijo: una cuenta de personal inactiva da ForbiddenError (rol antes que actividad)", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const inactiveStaff = await w.addMember("BIBLIOTECARIO", { active: false });
    const book = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: inactiveStaff.id, book_id: book.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  it("no se presta a una cuenta inactiva: ConflictError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const inactive = await w.addMember("ESTUDIANTE", { active: false });
    const book = await w.addBook(1);

    await expect(w.service.lend({ member_id: inactive.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );
    expect(await w.repos.loans.listAll()).toHaveLength(0);
  });

  it("una cuenta inactiva tampoco puede pedir a su propio nombre", async () => {
    const w = makeLoanWorld();
    const inactive = await w.addMember("DOCENTE", { active: false });
    const book = await w.addBook(1);

    await expect(w.service.lend({ member_id: inactive.id, book_id: book.id }, actorOf(inactive), NOW)).rejects.toThrow(
      ConflictError,
    );
  });
});

describe("F5 · prestar: bloqueo por préstamo vencido", () => {
  it("con un préstamo activo que venció 1 ms antes de ahora, no se presta otro libro", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const old = await w.addBook(1);
    const wanted = await w.addBook(1);
    await w.seedLoan(student.id, old.id, { due_at: isoPlus(NOW, -1) });

    await expect(
      w.service.lend({ member_id: student.id, book_id: wanted.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ConflictError);
    expect(await w.repos.loans.countActiveByMember(student.id)).toBe(1);
  });

  it("si el préstamo vence exactamente ahora, todavía no está vencido y se presta", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const old = await w.addBook(1);
    const wanted = await w.addBook(1);
    await w.seedLoan(student.id, old.id, { due_at: NOW.toISOString() });

    const loan = await w.service.lend({ member_id: student.id, book_id: wanted.id }, actorOf(librarian), NOW);

    expect(loan.book_id).toBe(wanted.id);
  });

  it("si el préstamo vence 1 ms después de ahora, se presta", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const old = await w.addBook(1);
    const wanted = await w.addBook(1);
    await w.seedLoan(student.id, old.id, { due_at: isoPlus(NOW, 1) });

    const loan = await w.service.lend({ member_id: student.id, book_id: wanted.id }, actorOf(librarian), NOW);

    expect(loan.book_id).toBe(wanted.id);
  });

  it("un préstamo vencido que ya se devolvió no bloquea", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const old = await w.addBook(1);
    const wanted = await w.addBook(1);
    await w.seedLoan(student.id, old.id, {
      due_at: isoPlus(NOW, -3 * DAY_MS),
      returned_at: isoPlus(NOW, -DAY_MS),
    });

    const loan = await w.service.lend({ member_id: student.id, book_id: wanted.id }, actorOf(librarian), NOW);

    expect(loan.book_id).toBe(wanted.id);
  });

  it("el vencido de otra persona no bloquea a quien pide", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const late = await w.addMember("ESTUDIANTE");
    const punctual = await w.addMember("ESTUDIANTE");
    const old = await w.addBook(2);
    await w.seedLoan(late.id, old.id, { due_at: isoPlus(NOW, -DAY_MS) });

    const loan = await w.service.lend({ member_id: punctual.id, book_id: old.id }, actorOf(librarian), NOW);

    expect(loan.member_id).toBe(punctual.id);
  });

  it("el propio prestatario con un vencido tampoco puede pedir otro libro", async () => {
    const w = makeLoanWorld();
    const external = await w.addMember("EXTERNO");
    const old = await w.addBook(1);
    const wanted = await w.addBook(1);
    await w.seedLoan(external.id, old.id, { due_at: isoPlus(NOW, -DAY_MS) });

    await expect(
      w.service.lend({ member_id: external.id, book_id: wanted.id }, actorOf(external), NOW),
    ).rejects.toThrow(ConflictError);
  });
});

describe("F5 · prestar: cupo de préstamos activos por rol", () => {
  it.each(BORROWER_ROLES)("un %s sin préstamos activos puede pedir (0 de cupo usado)", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember(role);
    const book = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: borrower.id, book_id: book.id }, actorOf(librarian), NOW),
    ).resolves.toMatchObject({ member_id: borrower.id });
  });

  it.each(BORROWER_ROLES)("un %s con cupo − 1 préstamos activos aún puede pedir uno más", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember(role);
    await w.seedActiveLoans(borrower.id, EXPECTED_CAP[role] - 1);
    const wanted = await w.addBook(1);

    await w.service.lend({ member_id: borrower.id, book_id: wanted.id }, actorOf(librarian), NOW);

    expect(await w.repos.loans.countActiveByMember(borrower.id)).toBe(EXPECTED_CAP[role]);
  });

  it.each(BORROWER_ROLES)("un %s con el cupo lleno recibe ConflictError", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember(role);
    await w.seedActiveLoans(borrower.id, EXPECTED_CAP[role]);
    const wanted = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: borrower.id, book_id: wanted.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ConflictError);
    expect(await w.repos.loans.countActiveByMember(borrower.id)).toBe(EXPECTED_CAP[role]);
  });

  it.each(BORROWER_ROLES)("un %s con cupo + 1 préstamos activos también recibe ConflictError", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const borrower = await w.addMember(role);
    await w.seedActiveLoans(borrower.id, EXPECTED_CAP[role] + 1);
    const wanted = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: borrower.id, book_id: wanted.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("un docente con 4 activos recibe el quinto y el sexto da ConflictError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const teacher = await w.addMember("DOCENTE");
    await w.seedActiveLoans(teacher.id, 4);
    const fifth = await w.addBook(1);
    const sixth = await w.addBook(1);

    const loan = await w.service.lend({ member_id: teacher.id, book_id: fifth.id }, actorOf(librarian), NOW);
    expect(loan.book_id).toBe(fifth.id);
    await expect(w.service.lend({ member_id: teacher.id, book_id: sixth.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );
  });

  it("un externo con 3 activos no recibe el cuarto", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const external = await w.addMember("EXTERNO");
    await w.seedActiveLoans(external.id, 3);
    const fourth = await w.addBook(1);

    await expect(
      w.service.lend({ member_id: external.id, book_id: fourth.id }, actorOf(librarian), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("los préstamos devueltos no ocupan cupo", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const external = await w.addMember("EXTERNO");
    const loans = await w.seedActiveLoans(external.id, 3);
    const first = loans[0];
    if (first === undefined) {
      throw new Error("faltó el primer préstamo sembrado");
    }
    await w.repos.loans.markReturned(first.id, isoPlus(NOW, -1000));
    const wanted = await w.addBook(1);

    const loan = await w.service.lend({ member_id: external.id, book_id: wanted.id }, actorOf(librarian), NOW);

    expect(loan.book_id).toBe(wanted.id);
  });
});
