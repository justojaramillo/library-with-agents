import { describe, expect, it } from "vitest";
import { createMemoryLoanRepository } from "../server/repository.memory";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import { DAY_MS, isoPlus, NOW } from "@/tests/helpers/loans";

const newLoan = (memberId: string, bookId: string, over: { returned_at?: string | null } = {}) => ({
  book_id: bookId,
  member_id: memberId,
  loaned_at: NOW.toISOString(),
  due_at: isoPlus(NOW, 15 * DAY_MS),
  returned_at: null,
  ...over,
});

describe("repositorio en memoria · createWithinLimits (F5, operación atómica)", () => {
  it("crea el préstamo con un id nuevo y lo deja activo", async () => {
    const repo = createMemoryLoanRepository();

    const outcome = await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 3 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("se esperaba un préstamo creado");
    }
    expect(outcome.loan.id.length).toBeGreaterThan(0);
    expect(outcome.loan).toMatchObject({ member_id: "m1", book_id: "b1", returned_at: null });
    expect(await repo.findById(outcome.loan.id)).toEqual(outcome.loan);
    expect(await repo.countActiveByMember("m1")).toBe(1);
    expect(await repo.countActiveByBook("b1")).toBe(1);
  });

  it("rechaza con ALREADY_HAS_BOOK si la persona ya tiene ese libro activo, y no crea nada", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 3 });

    const outcome = await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 3 });

    expect(outcome).toEqual({ ok: false, reason: "ALREADY_HAS_BOOK" });
    expect(await repo.listAll()).toHaveLength(1);
  });

  it("rechaza con MEMBER_LIMIT cuando el cupo está lleno (cupo = activos)", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 2 });
    await repo.createWithinLimits(newLoan("m1", "b2"), { bookCopies: 5, maxActiveForMember: 2 });

    const outcome = await repo.createWithinLimits(newLoan("m1", "b3"), { bookCopies: 5, maxActiveForMember: 2 });

    expect(outcome).toEqual({ ok: false, reason: "MEMBER_LIMIT" });
    expect(await repo.countActiveByMember("m1")).toBe(2);
  });

  it("con cupo − 1 activos aún crea el préstamo", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 2 });

    const outcome = await repo.createWithinLimits(newLoan("m1", "b2"), { bookCopies: 5, maxActiveForMember: 2 });

    expect(outcome.ok).toBe(true);
  });

  it("rechaza con NO_COPIES cuando los ejemplares están todos prestados (copias = activos)", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 3 });

    const outcome = await repo.createWithinLimits(newLoan("m2", "b1"), { bookCopies: 1, maxActiveForMember: 3 });

    expect(outcome).toEqual({ ok: false, reason: "NO_COPIES" });
    expect(await repo.countActiveByBook("b1")).toBe(1);
  });

  it("con copias − 1 prestados aún crea el préstamo", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 2, maxActiveForMember: 3 });

    const outcome = await repo.createWithinLimits(newLoan("m2", "b1"), { bookCopies: 2, maxActiveForMember: 3 });

    expect(outcome.ok).toBe(true);
  });

  it("los préstamos devueltos no cuentan ni para el cupo ni para los ejemplares ni para 'ya tiene el libro'", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1", { returned_at: isoPlus(NOW, DAY_MS) }), {
      bookCopies: 1,
      maxActiveForMember: 1,
    });
    // El anterior ya está devuelto: se crea uno nuevo del mismo libro con cupo 1 y 1 ejemplar.
    const stored = await repo.listAll();
    expect(stored).toHaveLength(1);

    const outcome = await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 1 });

    expect(outcome.ok).toBe(true);
  });

  it("el orden de las comprobaciones es: ya tiene el libro, luego cupo, luego ejemplares", async () => {
    const repo = createMemoryLoanRepository();
    await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 1 });

    // Fallan las tres a la vez → gana ALREADY_HAS_BOOK.
    expect(await repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 1 })).toEqual({
      ok: false,
      reason: "ALREADY_HAS_BOOK",
    });
    // Fallan cupo y ejemplares (otro libro, sin ejemplares) → gana MEMBER_LIMIT.
    await repo.createWithinLimits(newLoan("m2", "b2"), { bookCopies: 1, maxActiveForMember: 5 });
    expect(await repo.createWithinLimits(newLoan("m1", "b2"), { bookCopies: 1, maxActiveForMember: 1 })).toEqual({
      ok: false,
      reason: "MEMBER_LIMIT",
    });
  });

  it("peticiones simultáneas por el último ejemplar: solo una se crea", async () => {
    const repo = createMemoryLoanRepository();

    const outcomes = await Promise.all([
      repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 1, maxActiveForMember: 3 }),
      repo.createWithinLimits(newLoan("m2", "b1"), { bookCopies: 1, maxActiveForMember: 3 }),
      repo.createWithinLimits(newLoan("m3", "b1"), { bookCopies: 1, maxActiveForMember: 3 }),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.reason === "NO_COPIES")).toHaveLength(2);
    expect(await repo.countActiveByBook("b1")).toBe(1);
  });

  it("peticiones simultáneas por el último lugar del cupo: solo una se crea", async () => {
    const repo = createMemoryLoanRepository();

    const outcomes = await Promise.all([
      repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 1 }),
      repo.createWithinLimits(newLoan("m1", "b2"), { bookCopies: 5, maxActiveForMember: 1 }),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.reason === "MEMBER_LIMIT")).toHaveLength(1);
    expect(await repo.countActiveByMember("m1")).toBe(1);
  });

  it("la misma persona y el mismo libro a la vez: solo una se crea", async () => {
    const repo = createMemoryLoanRepository();

    const outcomes = await Promise.all([
      repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 3 }),
      repo.createWithinLimits(newLoan("m1", "b1"), { bookCopies: 5, maxActiveForMember: 3 }),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.reason === "ALREADY_HAS_BOOK")).toHaveLength(1);
    expect(await repo.listAll()).toHaveLength(1);
  });
});

describe("repositorio en memoria · consultas que usa el servicio", () => {
  it("listActiveByMember devuelve solo los activos de esa persona, ordenados por due_at", async () => {
    const repo = createMemoryLoanRepository();
    const late = await repo.create({ ...newLoan("m1", "b1"), due_at: isoPlus(NOW, 9 * DAY_MS) });
    const soon = await repo.create({ ...newLoan("m1", "b2"), due_at: isoPlus(NOW, 2 * DAY_MS) });
    await repo.create({ ...newLoan("m1", "b3"), returned_at: isoPlus(NOW, DAY_MS) });
    await repo.create(newLoan("m2", "b4"));

    expect(await repo.listActiveByMember("m1")).toEqual([soon, late]);
  });

  it("markReturned cierra el préstamo y deja de contarlo como activo", async () => {
    const repo = createMemoryLoanRepository();
    const loan = await repo.create(newLoan("m1", "b1"));

    const closed = await repo.markReturned(loan.id, isoPlus(NOW, DAY_MS));

    expect(closed.returned_at).toBe(isoPlus(NOW, DAY_MS));
    expect(await repo.countActiveByMember("m1")).toBe(0);
  });

  it("markReturned sobre un préstamo ya devuelto lanza ConflictError y no cambia returned_at", async () => {
    const repo = createMemoryLoanRepository();
    const loan = await repo.create(newLoan("m1", "b1"));
    await repo.markReturned(loan.id, isoPlus(NOW, DAY_MS));

    await expect(repo.markReturned(loan.id, isoPlus(NOW, 2 * DAY_MS))).rejects.toThrow(ConflictError);
    expect((await repo.findById(loan.id))?.returned_at).toBe(isoPlus(NOW, DAY_MS));
  });

  it("markReturned sobre un préstamo inexistente lanza NotFoundError", async () => {
    const repo = createMemoryLoanRepository();

    await expect(repo.markReturned("no-existe", isoPlus(NOW, DAY_MS))).rejects.toThrow(NotFoundError);
  });

  it("dos markReturned simultáneos: uno cierra el préstamo y el otro recibe ConflictError", async () => {
    const repo = createMemoryLoanRepository();
    const loan = await repo.create(newLoan("m1", "b1"));

    const results = await Promise.allSettled([
      repo.markReturned(loan.id, isoPlus(NOW, DAY_MS)),
      repo.markReturned(loan.id, isoPlus(NOW, 2 * DAY_MS)),
    ]);

    const rejected = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect((await repo.findById(loan.id))?.returned_at).toBe(isoPlus(NOW, DAY_MS));
  });
});
