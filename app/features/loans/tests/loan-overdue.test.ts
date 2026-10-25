import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { actorOf, DAY_MS, isoPlus, makeLoanWorld, NOW } from "@/tests/helpers/loans";

const HOUR_MS = 3_600_000;

describe("F8 · vencidos de una persona", () => {
  it("devuelve solo los vencidos, ordenados por due_at, con días de retraso y multa", async () => {
    const w = makeLoanWorld();
    const external = await w.addMember("EXTERNO");
    const recent = await w.addBook(1);
    const older = await w.addBook(1);
    const current = await w.addBook(1);
    // Se siembra primero el más reciente para comprobar que el orden no es el de inserción.
    const tenHours = await w.seedLoan(external.id, recent.id, { due_at: isoPlus(NOW, -10 * HOUR_MS) });
    const twoDays = await w.seedLoan(external.id, older.id, { due_at: isoPlus(NOW, -2 * DAY_MS) });
    await w.seedLoan(external.id, current.id, { due_at: isoPlus(NOW, 3 * DAY_MS) });

    const overdue = await w.service.listOverdue(external.id, actorOf(external), NOW);

    expect(overdue).toEqual([
      { loan: twoDays, days_late: 2, fine_cop: 1000 },
      { loan: tenHours, days_late: 1, fine_cop: 500 },
    ]);
  });

  it("el personal ve los vencidos de cualquier persona", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const teacher = await w.addMember("DOCENTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(teacher.id, book.id, { due_at: isoPlus(NOW, -DAY_MS) });

    const overdue = await w.service.listOverdue(teacher.id, actorOf(librarian), NOW);

    expect(overdue).toEqual([{ loan, days_late: 1, fine_cop: 500 }]);
  });

  it("el administrador también los consulta", async () => {
    const w = makeLoanWorld();
    const admin = await w.addMember("ADMINISTRADOR");
    const student = await w.addMember("ESTUDIANTE");

    await expect(w.service.listOverdue(student.id, actorOf(admin), NOW)).resolves.toEqual([]);
  });

  it("sin préstamos vencidos la lista es vacía", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, DAY_MS) });

    await expect(w.service.listOverdue(student.id, actorOf(student), NOW)).resolves.toEqual([]);
  });

  it("con un solo vencido la lista tiene un solo elemento", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, -DAY_MS - 1) });

    const overdue = await w.service.listOverdue(student.id, actorOf(student), NOW);

    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ days_late: 2, fine_cop: 1000 });
  });

  it("una cuenta de personal consultada por el personal existe y devuelve una lista vacía", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const other = await w.addMember("BIBLIOTECARIO");

    await expect(w.service.listOverdue(other.id, actorOf(librarian), NOW)).resolves.toEqual([]);
  });
});

describe("F8 · bordes del vencimiento", () => {
  it("con due_at = ahora − 1 ms ya está vencido (1 día de retraso)", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, -1) });

    const overdue = await w.service.listOverdue(student.id, actorOf(student), NOW);

    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ days_late: 1, fine_cop: 500 });
  });

  it("con due_at = ahora no está vencido", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: NOW.toISOString() });

    await expect(w.service.listOverdue(student.id, actorOf(student), NOW)).resolves.toEqual([]);
  });

  it("con due_at = ahora + 1 ms no está vencido", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, 1) });

    await expect(w.service.listOverdue(student.id, actorOf(student), NOW)).resolves.toEqual([]);
  });

  it("la multa respeta el tope: 41 días de retraso cuestan 20 000", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, -41 * DAY_MS) });

    const overdue = await w.service.listOverdue(student.id, actorOf(student), NOW);

    expect(overdue[0]).toMatchObject({ days_late: 41, fine_cop: 20_000 });
  });

  it("un préstamo vencido que ya se devolvió no aparece", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, {
      due_at: isoPlus(NOW, -5 * DAY_MS),
      returned_at: isoPlus(NOW, -DAY_MS),
    });

    await expect(w.service.listOverdue(student.id, actorOf(student), NOW)).resolves.toEqual([]);
  });

  it("no mezcla los vencidos de otras personas", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(2);
    await w.seedLoan(luis.id, book.id, { due_at: isoPlus(NOW, -3 * DAY_MS) });

    await expect(w.service.listOverdue(ana.id, actorOf(ana), NOW)).resolves.toEqual([]);
  });

  it("usa la estrategia de multa inyectada", async () => {
    const w = makeLoanWorld({ fine: { calculate: (daysLate) => daysLate * 7 } });
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: isoPlus(NOW, -2 * DAY_MS) });

    const overdue = await w.service.listOverdue(student.id, actorOf(student), NOW);

    expect(overdue[0]?.fine_cop).toBe(14);
  });
});

describe("F8 · autorización y errores", () => {
  it("un prestatario no ve los vencidos de otra persona que existe: ForbiddenError", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");

    await expect(w.service.listOverdue(luis.id, actorOf(ana), NOW)).rejects.toThrow(ForbiddenError);
  });

  it("un prestatario que consulta a una persona inexistente recibe ForbiddenError, no NotFoundError", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("EXTERNO");

    await expect(w.service.listOverdue("no-existe", actorOf(ana), NOW)).rejects.toThrow(ForbiddenError);
  });

  it("el mensaje es el mismo exista o no la otra persona", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("EXTERNO");
    const luis = await w.addMember("DOCENTE");

    const existing = await w.service.listOverdue(luis.id, actorOf(ana), NOW).then(
      () => new Error("no falló"),
      (error: Error) => error,
    );
    const missing = await w.service.listOverdue("no-existe", actorOf(ana), NOW).then(
      () => new Error("no falló"),
      (error: Error) => error,
    );

    expect(missing.message).toBe(existing.message);
  });

  it("el personal que consulta una cuenta inexistente recibe NotFoundError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");

    await expect(w.service.listOverdue("no-existe", actorOf(librarian), NOW)).rejects.toThrow(NotFoundError);
  });

  it("un prestatario cuya propia cuenta ya no existe recibe NotFoundError", async () => {
    const w = makeLoanWorld();

    await expect(w.service.listOverdue("fantasma", { member_id: "fantasma", role: "ESTUDIANTE" }, NOW)).rejects.toThrow(
      NotFoundError,
    );
  });
});
