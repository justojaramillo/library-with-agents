import { describe, expect, it } from "vitest";
import type { MemberRecord } from "@/features/accounts/server/repository";
import { ConflictError } from "@/shared/server/errors";
import { actorOf, DAY_MS, isoPlus, makeLoanWorld, NOW } from "@/tests/helpers/loans";

describe("F5 · prestar: ejemplares disponibles", () => {
  it("un libro con 1 ejemplar libre se presta", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);

    const loan = await w.service.lend({ member_id: student.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(loan.book_id).toBe(book.id);
    const listed = (await w.books.search("")).find((candidate) => candidate.id === book.id);
    expect(listed).toMatchObject({ copies: 1, available: 0 });
  });

  it("un libro con su único ejemplar prestado no se presta a otra persona; tras devolverlo, sí", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("DOCENTE");
    const book = await w.addBook(1);
    const first = await w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW);

    await expect(w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );

    await w.service.returnLoan(first.id, actorOf(librarian), minutesAfter(1));
    const second = await w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(librarian), minutesAfter(2));

    expect(second.member_id).toBe(luis.id);
  });

  it("con copies = 2, se prestan a dos personas y la tercera recibe ConflictError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const people = [await w.addMember("ESTUDIANTE"), await w.addMember("EXTERNO"), await w.addMember("DOCENTE")];
    const book = await w.addBook(2);
    const [one, two, three] = people;
    if (one === undefined || two === undefined || three === undefined) {
      throw new Error("faltaron cuentas de prueba");
    }

    await w.service.lend({ member_id: one.id, book_id: book.id }, actorOf(librarian), NOW);
    await w.service.lend({ member_id: two.id, book_id: book.id }, actorOf(librarian), NOW);

    await expect(w.service.lend({ member_id: three.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(2);
  });

  it("un libro con N ejemplares y N prestados no se presta; con N − 1 prestados, sí", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const book = await w.addBook(3);
    const holders = [await w.addMember("EXTERNO"), await w.addMember("EXTERNO"), await w.addMember("EXTERNO")];
    const late = await w.addMember("ESTUDIANTE");
    const [a, b, c] = holders;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("faltaron cuentas de prueba");
    }
    await w.seedLoan(a.id, book.id);
    await w.seedLoan(b.id, book.id);

    const loan = await w.service.lend({ member_id: c.id, book_id: book.id }, actorOf(librarian), NOW);
    expect(loan.book_id).toBe(book.id);

    await expect(w.service.lend({ member_id: late.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );
  });

  it("un préstamo devuelto libera su ejemplar: no cuenta contra la disponibilidad", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(ana.id, book.id, { returned_at: isoPlus(NOW, -DAY_MS) });

    const loan = await w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(loan.member_id).toBe(luis.id);
  });
});

describe("F5 · prestar: una persona no tiene dos ejemplares del mismo libro", () => {
  it("pedir el mismo libro otra vez da ConflictError aunque queden ejemplares; tras devolverlo, puede pedirlo", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(5);
    const first = await w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW);

    await expect(w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW)).rejects.toThrow(
      ConflictError,
    );
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(1);

    await w.service.returnLoan(first.id, actorOf(librarian), minutesAfter(1));
    const again = await w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), minutesAfter(2));

    expect(again.id).not.toBe(first.id);
    expect(again.returned_at).toBeNull();
  });

  it("el propio prestatario tampoco puede pedir dos veces el mismo libro", async () => {
    const w = makeLoanWorld();
    const ana = await w.addMember("DOCENTE");
    const book = await w.addBook(3);
    await w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(ana), NOW);

    await expect(w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(ana), NOW)).rejects.toThrow(
      ConflictError,
    );
  });

  it("varias personas distintas sí pueden tener ejemplares activos del mismo libro (uno por ejemplar)", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(2);

    await w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW);
    await w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(librarian), NOW);

    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(2);
  });
});

describe("F5 · prestar: atomicidad con peticiones simultáneas", () => {
  it("dos personas piden a la vez el último ejemplar: una recibe el préstamo y la otra ConflictError", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);

    const results = await Promise.allSettled([
      w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW),
      w.service.lend({ member_id: luis.id, book_id: book.id }, actorOf(librarian), NOW),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(1);
  });

  it("varias personas a la vez por un libro con 2 ejemplares: exactamente 2 lo consiguen", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const book = await w.addBook(2);
    const people: MemberRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      people.push(await w.addMember("EXTERNO"));
    }

    const results = await Promise.allSettled(
      people.map((person) => w.service.lend({ member_id: person.id, book_id: book.id }, actorOf(librarian), NOW)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictError);
      }
    }
    expect(await w.repos.loans.countActiveByBook(book.id)).toBe(2);
  });

  it("quien tiene 2 de 3 de cupo pide dos libros a la vez: solo uno entra y el total queda en 3", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const external = await w.addMember("EXTERNO");
    await w.seedActiveLoans(external.id, 2);
    const first = await w.addBook(1);
    const second = await w.addBook(1);

    const results = await Promise.allSettled([
      w.service.lend({ member_id: external.id, book_id: first.id }, actorOf(librarian), NOW),
      w.service.lend({ member_id: external.id, book_id: second.id }, actorOf(librarian), NOW),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]?.reason).toBeInstanceOf(ConflictError);
    expect(await w.repos.loans.countActiveByMember(external.id)).toBe(3);
  });

  it("con el cupo lleno (3 activos) dos pedidos simultáneos dan ConflictError y siguen 3 activos", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const external = await w.addMember("EXTERNO");
    await w.seedActiveLoans(external.id, 3);
    const first = await w.addBook(3);
    const second = await w.addBook(3);

    const results = await Promise.allSettled([
      w.service.lend({ member_id: external.id, book_id: first.id }, actorOf(librarian), NOW),
      w.service.lend({ member_id: external.id, book_id: second.id }, actorOf(librarian), NOW),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictError);
      }
    }
    expect(await w.repos.loans.countActiveByMember(external.id)).toBe(3);
  });

  it("la misma persona pide el mismo libro dos veces a la vez: queda un solo préstamo activo", async () => {
    const w = makeLoanWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(5);

    const results = await Promise.allSettled([
      w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW),
      w.service.lend({ member_id: ana.id, book_id: book.id }, actorOf(librarian), NOW),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]?.reason).toBeInstanceOf(ConflictError);
    expect(await w.repos.loans.countActiveByMember(ana.id)).toBe(1);
    expect(await w.repos.loans.listAll()).toHaveLength(1);
  });
});

/** Instante `minutes` minutos después de `NOW`. */
function minutesAfter(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}
