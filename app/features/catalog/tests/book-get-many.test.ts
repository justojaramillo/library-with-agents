import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createMemoryBookRepository } from "@/features/catalog/server/repository.memory";
import { aBook, makeWorld } from "@/tests/helpers/factories";
import { makeLoanWorld } from "@/tests/helpers/loans";

/** `count` ids que no existen en el catálogo (nunca se crearon). */
function missingIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `no-existe-${i}`);
}

describe("F34–F35 · BookService.getMany (lectura por lote)", () => {
  it("una lista vacía devuelve una lista vacía", async () => {
    const { books } = makeWorld();
    expect(await books.getMany([])).toEqual([]);
  });

  it("devuelve solo los libros pedidos, no el catálogo completo", async () => {
    const { books } = makeWorld();
    const first = await books.create(aBook());
    await books.create(aBook());
    const third = await books.create(aBook());
    const found = await books.getMany([first.id, third.id]);
    expect(found.map((book) => book.id)).toEqual([first.id, third.id]);
  });

  it("devuelve cada libro con sus datos completos", async () => {
    const { books } = makeWorld();
    const created = await books.create(aBook({ title: "Cien años de soledad", author: "García Márquez", copies: 3 }));
    expect(await books.getMany([created.id])).toEqual([created]);
  });

  it("ignora los ids repetidos: cada libro sale una sola vez", async () => {
    const { books } = makeWorld();
    const book = await books.create(aBook());
    const found = await books.getMany([book.id, book.id, book.id]);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(book.id);
  });

  it("ignora los ids inexistentes sin fallar", async () => {
    const { books } = makeWorld();
    const book = await books.create(aBook());
    const found = await books.getMany(["no-existe", book.id, "tampoco"]);
    expect(found.map((item) => item.id)).toEqual([book.id]);
  });

  it("si ningún id existe devuelve una lista vacía", async () => {
    const { books } = makeWorld();
    expect(await books.getMany(["a", "b"])).toEqual([]);
  });

  it("conserva el orden de los ids recibidos, no el del catálogo", async () => {
    const { books } = makeWorld();
    const first = await books.create(aBook({ title: "Aaa" }));
    const second = await books.create(aBook({ title: "Bbb" }));
    const third = await books.create(aBook({ title: "Ccc" }));
    const found = await books.getMany([third.id, first.id, second.id]);
    expect(found.map((book) => book.id)).toEqual([third.id, first.id, second.id]);
  });

  it("el orden se respeta aunque haya repetidos e inexistentes mezclados", async () => {
    const { books } = makeWorld();
    const first = await books.create(aBook());
    const second = await books.create(aBook());
    const found = await books.getMany([second.id, "no-existe", first.id, second.id]);
    expect(found.map((book) => book.id)).toEqual([second.id, first.id]);
  });

  it("calcula `available` con los préstamos activos de cada libro", async () => {
    const world = makeLoanWorld();
    const member = await world.addMember("ESTUDIANTE");
    const lentOut = await world.addBook(3);
    const untouched = await world.addBook(2);
    const soldOut = await world.addBook(1);
    await world.seedLoan(member.id, lentOut.id);
    await world.seedLoan(member.id, soldOut.id);
    const found = await world.books.getMany([lentOut.id, untouched.id, soldOut.id]);
    expect(found.map((book) => book.available)).toEqual([2, 2, 0]);
  });

  it("un préstamo devuelto no resta disponibilidad", async () => {
    const world = makeLoanWorld();
    const member = await world.addMember("ESTUDIANTE");
    const book = await world.addBook(1);
    await world.seedLoan(member.id, book.id, { returned_at: "2026-01-09T10:00:00.000Z" });
    const [found] = await world.books.getMany([book.id]);
    expect(found?.available).toBe(1);
  });

  describe("tope de 500 ids por llamada", () => {
    it("acepta exactamente 500 ids", async () => {
      const { books } = makeWorld();
      const book = await books.create(aBook());
      const found = await books.getMany([book.id, ...missingIds(499)]);
      expect(found.map((item) => item.id)).toEqual([book.id]);
    });

    it("rechaza 501 ids con un error de validación", async () => {
      const { books } = makeWorld();
      await expect(books.getMany(missingIds(501))).rejects.toThrow(ZodError);
    });

    it("500 ids repetidos del mismo libro no superan el tope y devuelven uno", async () => {
      const { books } = makeWorld();
      const book = await books.create(aBook());
      const found = await books.getMany(Array.from({ length: 500 }, () => book.id));
      expect(found).toHaveLength(1);
    });
  });

  describe("ids con forma inválida", () => {
    it("rechaza un id vacío", async () => {
      const { books } = makeWorld();
      await expect(books.getMany([""])).rejects.toThrow(ZodError);
    });

    it("rechaza un id con «/»", async () => {
      const { books } = makeWorld();
      await expect(books.getMany(["libros/uno"])).rejects.toThrow(ZodError);
    });

    it("rechaza un id de más de 128 caracteres", async () => {
      const { books } = makeWorld();
      await expect(books.getMany(["x".repeat(129)])).rejects.toThrow(ZodError);
    });

    it("un solo id inválido entre ids válidos rechaza toda la llamada", async () => {
      const { books } = makeWorld();
      const book = await books.create(aBook());
      await expect(books.getMany([book.id, "a/b"])).rejects.toThrow(ZodError);
    });
  });
});

describe("F34–F35 · BookRepository en memoria · findByIds", () => {
  it("devuelve solo los libros con esos ids", async () => {
    const repo = createMemoryBookRepository();
    const first = await repo.create({ ...aBook() });
    await repo.create({ ...aBook() });
    const found = await repo.findByIds([first.id]);
    expect(found.map((book) => book.id)).toEqual([first.id]);
  });

  it("una lista vacía devuelve una lista vacía", async () => {
    const repo = createMemoryBookRepository();
    await repo.create({ ...aBook() });
    expect(await repo.findByIds([])).toEqual([]);
  });

  it("ignora los ids inexistentes", async () => {
    const repo = createMemoryBookRepository();
    expect(await repo.findByIds(["no-existe"])).toEqual([]);
  });

  it("devuelve copias: cambiar el resultado no altera el repositorio", async () => {
    const repo = createMemoryBookRepository();
    const created = await repo.create({ ...aBook({ title: "Original" }) });
    const [copy] = await repo.findByIds([created.id]);
    if (copy === undefined) {
      throw new Error("El libro debía existir");
    }
    copy.title = "Cambiado";
    expect((await repo.findById(created.id))?.title).toBe("Original");
  });
});
