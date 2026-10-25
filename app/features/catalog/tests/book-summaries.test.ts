import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Id } from "@/shared/schema";
import { createBookService } from "@/features/catalog/server/book-service";
import { createMemoryBookRepository } from "@/features/catalog/server/repository.memory";
import type { ActiveLoansReader } from "@/features/catalog/server/repository";
import { aBook } from "@/tests/helpers/factories";

/** Lector de préstamos espía: cuenta las veces que el servicio pregunta por préstamos activos. */
function makeSpyLoans() {
  const calls: Id[] = [];
  const reader: ActiveLoansReader = {
    async countActiveByBook(bookId) {
      calls.push(bookId);
      return 0;
    },
  };
  return { reader, calls };
}

function makeSummaryWorld() {
  const repo = createMemoryBookRepository();
  const spy = makeSpyLoans();
  const books = createBookService({ books: repo, loans: spy.reader });
  return { repo, books, calls: spy.calls };
}

function missingIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `no-existe-${i}`);
}

describe("F34–F35 · BookService.getSummaries (título y autor sin disponibilidad)", () => {
  it("una lista vacía devuelve una lista vacía", async () => {
    const { books } = makeSummaryWorld();
    expect(await books.getSummaries([])).toEqual([]);
  });

  it("devuelve solo id, título y autor: sin `available`, ISBN ni ejemplares", async () => {
    const { repo, books } = makeSummaryWorld();
    const created = await repo.create(aBook({ title: "Cien años de soledad", author: "García Márquez", copies: 3 }));
    const found = await books.getSummaries([created.id]);
    expect(found).toEqual([{ id: created.id, title: "Cien años de soledad", author: "García Márquez" }]);
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(["author", "id", "title"]);
    expect(found[0]).not.toHaveProperty("available");
  });

  it("devuelve solo los libros pedidos, no el catálogo completo", async () => {
    const { repo, books } = makeSummaryWorld();
    const first = await repo.create(aBook());
    await repo.create(aBook());
    const third = await repo.create(aBook());
    const found = await books.getSummaries([first.id, third.id]);
    expect(found.map((item) => item.id)).toEqual([first.id, third.id]);
  });

  it("ignora los ids repetidos: cada libro sale una sola vez", async () => {
    const { repo, books } = makeSummaryWorld();
    const book = await repo.create(aBook());
    const found = await books.getSummaries([book.id, book.id, book.id]);
    expect(found.map((item) => item.id)).toEqual([book.id]);
  });

  it("ignora los ids inexistentes sin fallar", async () => {
    const { repo, books } = makeSummaryWorld();
    const book = await repo.create(aBook());
    const found = await books.getSummaries(["no-existe", book.id, "tampoco"]);
    expect(found.map((item) => item.id)).toEqual([book.id]);
  });

  it("si ningún id existe devuelve una lista vacía", async () => {
    const { books } = makeSummaryWorld();
    expect(await books.getSummaries(["a", "b"])).toEqual([]);
  });

  it("conserva el orden de los ids recibidos, también con repetidos e inexistentes mezclados", async () => {
    const { repo, books } = makeSummaryWorld();
    const first = await repo.create(aBook({ title: "Aaa" }));
    const second = await repo.create(aBook({ title: "Bbb" }));
    const third = await repo.create(aBook({ title: "Ccc" }));
    const found = await books.getSummaries([third.id, "no-existe", first.id, third.id, second.id]);
    expect(found.map((item) => item.id)).toEqual([third.id, first.id, second.id]);
  });

  it("no consulta los préstamos activos, ni con un libro ni con varios", async () => {
    const { repo, books, calls } = makeSummaryWorld();
    const first = await repo.create(aBook());
    const second = await repo.create(aBook());
    await books.getSummaries([first.id]);
    await books.getSummaries([first.id, second.id, "no-existe"]);
    expect(calls).toEqual([]);
  });

  it("en contraste, `getMany` sí consulta los préstamos (una vez por libro encontrado)", async () => {
    const { repo, books, calls } = makeSummaryWorld();
    const first = await repo.create(aBook());
    const second = await repo.create(aBook());
    await books.getMany([first.id, second.id]);
    expect(calls.sort()).toEqual([first.id, second.id].sort());
  });

  describe("tope de 500 ids por llamada", () => {
    it("acepta exactamente 500 ids", async () => {
      const { repo, books } = makeSummaryWorld();
      const book = await repo.create(aBook());
      const found = await books.getSummaries([book.id, ...missingIds(499)]);
      expect(found.map((item) => item.id)).toEqual([book.id]);
    });

    it("rechaza 501 ids con un error de validación", async () => {
      const { books } = makeSummaryWorld();
      await expect(books.getSummaries(missingIds(501))).rejects.toThrow(ZodError);
    });
  });

  describe("ids con forma inválida", () => {
    it("rechaza un id vacío", async () => {
      const { books } = makeSummaryWorld();
      await expect(books.getSummaries([""])).rejects.toThrow(ZodError);
    });

    it("rechaza un id con «/»", async () => {
      const { books } = makeSummaryWorld();
      await expect(books.getSummaries(["libros/uno"])).rejects.toThrow(ZodError);
    });

    it("un solo id inválido entre ids válidos rechaza toda la llamada", async () => {
      const { repo, books } = makeSummaryWorld();
      const book = await repo.create(aBook());
      await expect(books.getSummaries([book.id, "a/b"])).rejects.toThrow(ZodError);
    });
  });
});
