import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import type { Role } from "@/shared/schema";
import { actorOf, DAY_MS, isoPlus, makeLoanWorld, NOW } from "@/tests/helpers/loans";
import { ActiveLoanSchema } from "../schema";

const BORROWERS: Role[] = ["EXTERNO", "ESTUDIANTE", "DOCENTE"];
const STAFF: Role[] = ["BIBLIOTECARIO", "ADMINISTRADOR"];

describe("F34 · listActive: todos los préstamos activos (solo personal)", () => {
  it.each(STAFF)("%s ve los préstamos activos de todas las personas", async (role) => {
    const w = makeLoanWorld();
    const staff = await w.addMember(role);
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("DOCENTE");
    const first = await w.seedLoan(ana.id, (await w.addBook(1)).id);
    const second = await w.seedLoan(luis.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, 6 * DAY_MS) });

    const list = await w.service.listActive(actorOf(staff), NOW);

    expect(list).toEqual([
      { loan: first, days_late: 0, fine_cop: 0 },
      { loan: second, days_late: 0, fine_cop: 0 },
    ]);
    expect(ActiveLoanSchema.array().safeParse(list).success).toBe(true);
  });

  it.each(BORROWERS)("un %s no puede ver la lista completa: ForbiddenError", async (role) => {
    const w = makeLoanWorld();
    const borrower = await w.addMember(role);

    await expect(w.service.listActive(actorOf(borrower), NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("la autorización va antes de consultar: un prestatario no provoca ninguna lectura de préstamos", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    const spy = vi.spyOn(w.repos.loans, "listActive");

    await expect(w.service.listActive(actorOf(student), NOW)).rejects.toBeInstanceOf(ForbiddenError);

    expect(spy).not.toHaveBeenCalled();
  });

  it("sin préstamos activos devuelve una lista vacía", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");

    await expect(w.service.listActive(actorOf(librarian), NOW)).resolves.toEqual([]);
  });

  it("con un solo préstamo activo devuelve un solo elemento", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const loan = await w.seedLoan(student.id, (await w.addBook(1)).id);

    await expect(w.service.listActive(actorOf(librarian), NOW)).resolves.toEqual([{ loan, days_late: 0, fine_cop: 0 }]);
  });

  it("los devueltos no aparecen", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const active = await w.seedLoan(student.id, (await w.addBook(1)).id);
    await w.seedLoan(student.id, (await w.addBook(1)).id, { returned_at: isoPlus(NOW, -DAY_MS) });

    const list = await w.service.listActive(actorOf(librarian), NOW);

    expect(list.map((item) => item.loan.id)).toEqual([active.id]);
  });

  it("incluye también los vencidos, con sus días de retraso y su multa", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const late = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, -2 * DAY_MS - 1) });
    const ok = await w.seedLoan(student.id, (await w.addBook(1)).id);

    const list = await w.service.listActive(actorOf(librarian), NOW);

    expect(list).toEqual([
      { loan: late, days_late: 3, fine_cop: 1500 },
      { loan: ok, days_late: 0, fine_cop: 0 },
    ]);
  });

  it("se ordenan por vencimiento ascendente, sea cual sea el orden en que se crearon", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const later = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, 9 * DAY_MS) });
    const sooner = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, 2 * DAY_MS) });
    const overdue = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, -DAY_MS) });

    const list = await w.service.listActive(actorOf(librarian), NOW);

    expect(list.map((item) => item.loan.id)).toEqual([overdue.id, sooner.id, later.id]);
  });

  it("con el mismo vencimiento desempata por fecha de préstamo (la más antigua primero)", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const due = isoPlus(NOW, 3 * DAY_MS);
    const recent = await w.seedLoan(student.id, (await w.addBook(1)).id, {
      due_at: due,
      loaned_at: isoPlus(NOW, -DAY_MS),
    });
    const oldest = await w.seedLoan(student.id, (await w.addBook(1)).id, {
      due_at: due,
      loaned_at: isoPlus(NOW, -4 * DAY_MS),
    });

    const list = await w.service.listActive(actorOf(librarian), NOW);

    expect(list.map((item) => item.loan.id)).toEqual([oldest.id, recent.id]);
  });

  it("con vencimiento y fecha de préstamo iguales desempata por id ascendente", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const a = await w.seedLoan(student.id, (await w.addBook(1)).id);
    const b = await w.seedLoan(student.id, (await w.addBook(1)).id);
    const c = await w.seedLoan(student.id, (await w.addBook(1)).id);

    const list = await w.service.listActive(actorOf(librarian), NOW);

    expect(list.map((item) => item.loan.id)).toEqual([a.id, b.id, c.id].sort());
  });

  it("el orden es el mismo en dos consultas seguidas", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    await w.seedLoan(student.id, (await w.addBook(1)).id);
    await w.seedLoan(student.id, (await w.addBook(1)).id);

    const first = await w.service.listActive(actorOf(librarian), NOW);
    const second = await w.service.listActive(actorOf(librarian), NOW);

    expect(second).toEqual(first);
  });
});

describe("F34 · días de retraso y multa en los activos (bordes del vencimiento)", () => {
  async function onlyItem(dueAt: string) {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: dueAt });
    const list = await w.service.listActive(actorOf(librarian), NOW);
    expect(list).toHaveLength(1);
    return list[0];
  }

  it.each([
    ["now − 1 ms: vencido por una fracción de día cuenta como 1 día", -1, 1, 500],
    ["now exacto: todavía no está vencido", 0, 0, 0],
    ["now + 1 ms: no está vencido", 1, 0, 0],
    ["exactamente 1 día de retraso: 1 día", -DAY_MS, 1, 500],
    ["1 día y 1 ms de retraso: 2 días", -DAY_MS - 1, 2, 1000],
    ["40 días de retraso: justo el tope de la multa", -40 * DAY_MS, 40, 20_000],
    ["41 días de retraso: la multa no pasa del tope", -41 * DAY_MS, 41, 20_000],
    ["100 días de retraso: la multa sigue en el tope", -100 * DAY_MS, 100, 20_000],
  ])("%s", async (_name, offsetMs, daysLate, fine) => {
    const item = await onlyItem(isoPlus(NOW, offsetMs));

    expect(item).toMatchObject({ days_late: daysLate, fine_cop: fine });
  });
});

describe("F34 · F35 · listActiveByMember: los activos de una persona", () => {
  it("el prestatario ve solo los suyos, con el estado a la fecha", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const late = await w.seedLoan(ana.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, -DAY_MS) });
    const ok = await w.seedLoan(ana.id, (await w.addBook(1)).id);
    await w.seedLoan(luis.id, (await w.addBook(1)).id);

    const list = await w.service.listActiveByMember(ana.id, actorOf(ana), NOW);

    expect(list).toEqual([
      { loan: late, days_late: 1, fine_cop: 500 },
      { loan: ok, days_late: 0, fine_cop: 0 },
    ]);
  });

  it.each(STAFF)("%s consulta los de cualquier prestatario", async (role) => {
    const w = makeLoanWorld();
    const staff = await w.addMember(role);
    const teacher = await w.addMember("DOCENTE");
    const loan = await w.seedLoan(teacher.id, (await w.addBook(1)).id);

    await expect(w.service.listActiveByMember(teacher.id, actorOf(staff), NOW)).resolves.toEqual([
      { loan, days_late: 0, fine_cop: 0 },
    ]);
  });

  it("una persona sin préstamos activos recibe una lista vacía", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");

    await expect(w.service.listActiveByMember(student.id, actorOf(student), NOW)).resolves.toEqual([]);
  });

  it("los devueltos no aparecen y los vencidos sí", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("EXTERNO");
    const overdue = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, -2 * DAY_MS) });
    await w.seedLoan(student.id, (await w.addBook(1)).id, { returned_at: isoPlus(NOW, -DAY_MS) });

    const list = await w.service.listActiveByMember(student.id, actorOf(student), NOW);

    expect(list).toEqual([{ loan: overdue, days_late: 2, fine_cop: 1000 }]);
  });

  it("se ordenan por vencimiento, luego por fecha de préstamo y luego por id", async () => {
    const w = makeLoanWorld();
    const student = await w.addMember("DOCENTE");
    const same = isoPlus(NOW, 4 * DAY_MS);
    const late = await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, 8 * DAY_MS) });
    const newerLoan = await w.seedLoan(student.id, (await w.addBook(1)).id, {
      due_at: same,
      loaned_at: isoPlus(NOW, -DAY_MS),
    });
    const olderLoan = await w.seedLoan(student.id, (await w.addBook(1)).id, {
      due_at: same,
      loaned_at: isoPlus(NOW, -3 * DAY_MS),
    });

    const list = await w.service.listActiveByMember(student.id, actorOf(student), NOW);

    expect(list.map((item) => item.loan.id)).toEqual([olderLoan.id, newerLoan.id, late.id]);
  });

  it.each([
    ["now − 1 ms", -1, 1],
    ["now", 0, 0],
    ["now + 1 ms", 1, 0],
  ])("con vencimiento en %s los días de retraso son %i", async (_name, offsetMs, daysLate) => {
    const w = makeLoanWorld();
    const student = await w.addMember("ESTUDIANTE");
    await w.seedLoan(student.id, (await w.addBook(1)).id, { due_at: isoPlus(NOW, offsetMs) });

    const [item] = await w.service.listActiveByMember(student.id, actorOf(student), NOW);

    expect(item.days_late).toBe(daysLate);
    expect(item.fine_cop).toBe(daysLate * 500);
  });

  it("un prestatario que pide los de otra persona que existe: ForbiddenError", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");

    await expect(w.service.listActiveByMember(luis.id, actorOf(ana), NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un prestatario que pide los de una cuenta que no existe: también ForbiddenError, no NotFoundError", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");

    await expect(w.service.listActiveByMember("no-existe", actorOf(ana), NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("la autorización va antes de consultar: ni se busca la cuenta ni se leen préstamos", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const findMember = vi.spyOn(w.repos.members, "findById");
    const listLoans = vi.spyOn(w.repos.loans, "listActive");

    await expect(w.service.listActiveByMember(luis.id, actorOf(ana), NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.service.listActiveByMember("no-existe", actorOf(ana), NOW)).rejects.toBeInstanceOf(ForbiddenError);

    expect(findMember).not.toHaveBeenCalled();
    expect(listLoans).not.toHaveBeenCalled();
  });

  it("el personal que pide una cuenta inexistente recibe NotFoundError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");

    await expect(w.service.listActiveByMember("no-existe", actorOf(librarian), NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("un prestatario cuya propia cuenta ya no existe recibe NotFoundError", async () => {
    const w = makeLoanWorld();
    const ghost = { member_id: "borrada", role: "ESTUDIANTE" as const };

    await expect(w.service.listActiveByMember("borrada", ghost, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(STAFF)("una cuenta de %s consultada por el personal devuelve una lista vacía", async (role) => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const other = await w.addMember(role);

    await expect(w.service.listActiveByMember(other.id, actorOf(librarian), NOW)).resolves.toEqual([]);
  });
});

describe("F34 · repositorio en memoria: listActive", () => {
  it("sin préstamos devuelve una lista vacía", async () => {
    const w = makeLoanWorld();

    await expect(w.repos.loans.listActive()).resolves.toEqual([]);
  });

  it("devuelve solo los préstamos sin devolver, de todas las personas", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("EXTERNO");
    const one = await w.seedLoan(ana.id, (await w.addBook(1)).id);
    await w.seedLoan(ana.id, (await w.addBook(1)).id, { returned_at: isoPlus(NOW, -DAY_MS) });
    const two = await w.seedLoan(luis.id, (await w.addBook(1)).id);

    const active = await w.repos.loans.listActive();

    expect(active).toHaveLength(2);
    expect(active).toEqual(expect.arrayContaining([one, two]));
  });

  it("un préstamo que se devuelve deja de aparecer", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const loan = await w.seedLoan(ana.id, (await w.addBook(1)).id);
    expect(await w.repos.loans.listActive()).toHaveLength(1);

    await w.repos.loans.markReturned(loan.id, NOW.toISOString());

    await expect(w.repos.loans.listActive()).resolves.toEqual([]);
  });
});
