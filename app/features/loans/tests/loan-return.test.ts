import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { actorOf, DAY_MS, makeLoanWorld, NOW } from "@/tests/helpers/loans";

const DUE = new Date("2026-02-01T08:30:00.000Z");

/** Mundo con un préstamo activo que vence en `DUE`. */
async function worldWithLoan() {
  const w = makeLoanWorld();
  const librarian = await w.addMember("BIBLIOTECARIO");
  const student = await w.addMember("ESTUDIANTE");
  const book = await w.addBook(1);
  const loan = await w.seedLoan(student.id, book.id, { due_at: DUE.toISOString() });
  return { w, librarian, student, book, loan };
}

describe("F6 · devolver libro", () => {
  it("el bibliotecario devuelve a tiempo: guarda returned_at y la multa es 0", async () => {
    const { w, librarian, loan } = await worldWithLoan();
    const now = new Date("2026-01-20T12:00:00.000Z");

    const result = await w.service.returnLoan(loan.id, actorOf(librarian), now);

    expect(result.fine_cop).toBe(0);
    expect(result.loan).toEqual({ ...loan, returned_at: "2026-01-20T12:00:00.000Z" });
    expect(await w.repos.loans.findById(loan.id)).toEqual(result.loan);
  });

  it("el administrador también puede devolver", async () => {
    const { w, loan } = await worldWithLoan();
    const admin = await w.addMember("ADMINISTRADOR");

    const result = await w.service.returnLoan(loan.id, actorOf(admin), NOW);

    expect(result.loan.returned_at).toBe(NOW.toISOString());
  });

  it("un préstamo devuelto deja de contar como activo para la persona y para el libro", async () => {
    const { w, librarian, student, book, loan } = await worldWithLoan();
    expect(await w.repos.loans.countActiveByMember(student.id)).toBe(1);

    await w.service.returnLoan(loan.id, actorOf(librarian), NOW);

    expect(await w.repos.loans.countActiveByMember(student.id)).toBe(0);
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(0);
    const listed = (await w.books.search("")).find((candidate) => candidate.id === book.id);
    expect(listed?.available).toBe(1);
  });

  it("la multa solo se informa: el préstamo guardado no tiene campo de multa", async () => {
    const { w, librarian, loan } = await worldWithLoan();

    await w.service.returnLoan(loan.id, actorOf(librarian), new Date(DUE.getTime() + 3 * DAY_MS));

    const stored = await w.repos.loans.findById(loan.id);
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["book_id", "due_at", "id", "loaned_at", "member_id", "returned_at"].sort(),
    );
  });
});

describe("F6 · multa al devolver (500 COP por día, tope 20 000)", () => {
  it.each([
    ["antes del vencimiento", -DAY_MS, 0],
    ["exactamente en el vencimiento", 0, 0],
    ["1 ms después (1 día de retraso)", 1, 500],
    ["24 h después", DAY_MS, 500],
    ["24 h y 1 ms después", DAY_MS + 1, 1000],
    ["40 días después", 40 * DAY_MS, 20_000],
    ["41 días después (tope)", 41 * DAY_MS, 20_000],
  ])("devuelto %s: multa de %i COP", async (_name, offsetMs, expectedFine) => {
    const { w, librarian, loan } = await worldWithLoan();

    const result = await w.service.returnLoan(loan.id, actorOf(librarian), new Date(DUE.getTime() + offsetMs));

    expect(result.fine_cop).toBe(expectedFine);
  });

  it("usa la estrategia de multa inyectada, sin tocar el servicio", async () => {
    const w = makeLoanWorld({ fine: { calculate: (daysLate) => daysLate * 7 } });
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id, { due_at: DUE.toISOString() });

    const result = await w.service.returnLoan(loan.id, actorOf(librarian), new Date(DUE.getTime() + 2 * DAY_MS));

    expect(result.fine_cop).toBe(14);
  });
});

describe("F6 · devolver: errores y autorización", () => {
  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] as const)("un %s no puede devolver: ForbiddenError y el préstamo sigue activo", async (role) => {
    const { w, loan } = await worldWithLoan();
    const borrower = await w.addMember(role);

    await expect(w.service.returnLoan(loan.id, actorOf(borrower), NOW)).rejects.toThrow(ForbiddenError);
    expect((await w.repos.loans.findById(loan.id))?.returned_at).toBeNull();
  });

  it("ni el dueño del préstamo puede devolver su propio libro", async () => {
    const { w, student, loan } = await worldWithLoan();

    await expect(w.service.returnLoan(loan.id, actorOf(student), NOW)).rejects.toThrow(ForbiddenError);
  });

  it("un prestatario que devuelve un id inexistente recibe ForbiddenError (antes de buscar el préstamo)", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");

    await expect(w.service.returnLoan("no-existe", actorOf(student), NOW)).rejects.toThrow(ForbiddenError);
  });

  it("el personal que devuelve un id inexistente recibe NotFoundError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");

    await expect(w.service.returnLoan("no-existe", actorOf(librarian), NOW)).rejects.toThrow(NotFoundError);
  });

  it("devolver dos veces da ConflictError y returned_at no cambia", async () => {
    const { w, librarian, loan } = await worldWithLoan();
    await w.service.returnLoan(loan.id, actorOf(librarian), NOW);

    const nextDay = new Date(NOW.getTime() + DAY_MS);

    await expect(w.service.returnLoan(loan.id, actorOf(librarian), nextDay)).rejects.toThrow(ConflictError);
    expect((await w.repos.loans.findById(loan.id))?.returned_at).toBe(NOW.toISOString());
  });

  it("dos devoluciones simultáneas: una tiene éxito, la otra recibe ConflictError y returned_at conserva la primera", async () => {
    const { w, librarian, loan } = await worldWithLoan();
    const staff = actorOf(librarian);

    const results = await Promise.allSettled([
      w.service.returnLoan(loan.id, staff, NOW),
      w.service.returnLoan(loan.id, staff, NOW),
    ]);

    const rejected = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect((await w.repos.loans.findById(loan.id))?.returned_at).toBe(NOW.toISOString());
  });

  it("cinco devoluciones simultáneas: un éxito y cuatro ConflictError", async () => {
    const { w, librarian, loan } = await worldWithLoan();
    const staff = actorOf(librarian);

    const results = await Promise.allSettled([
      w.service.returnLoan(loan.id, staff, NOW),
      w.service.returnLoan(loan.id, staff, NOW),
      w.service.returnLoan(loan.id, staff, NOW),
      w.service.returnLoan(loan.id, staff, NOW),
      w.service.returnLoan(loan.id, staff, NOW),
    ]);

    const rejected = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ConflictError);
    }
    expect((await w.repos.loans.findById(loan.id))?.returned_at).toBe(NOW.toISOString());
  });

  it("tras devolver, la persona puede volver a pedir el mismo libro", async () => {
    const { w, librarian, student, book, loan } = await worldWithLoan();
    await w.service.returnLoan(loan.id, actorOf(librarian), NOW);

    const again = await w.service.lend({ member_id: student.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(again.returned_at).toBeNull();
  });
});
