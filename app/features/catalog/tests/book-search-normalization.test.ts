import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer } from "@/features/container";
import { aBook } from "@/tests/helpers/factories";
import type { Book } from "../schema";
import { filterBooks } from "../server/book-search";
import type { BookRecord } from "../server/repository";

/** S1 regla 13: la clave de la caché del catálogo es canónica y el resultado no cambia al normalizar. */
const cache = vi.hoisted(() => ({
  searchBooksCached: vi.fn<(q: string, limit?: number) => Promise<Book[]>>(),
  registerBookSearch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/features/catalog/server/book-search-cache", () => ({
  BOOKS_CACHE_TAG: "books",
  registerBookSearch: cache.registerBookSearch,
  searchBooksCached: cache.searchBooksCached,
}));
// Construir el contenedor toca las colecciones al crear los repositorios, pero no lee ni escribe nada.
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({}),
  getAdminDb: () => ({ collection: () => ({}) }),
}));

beforeEach(() => {
  cache.searchBooksCached.mockReset();
  cache.searchBooksCached.mockResolvedValue([]);
});

/** Argumentos con los que se pidió la caché en la última llamada. */
function lastCall(): [string, number | undefined] {
  const call = cache.searchBooksCached.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("no se llamó a la búsqueda cacheada");
  }
  return [call[0], call[1]];
}

describe("S1 regla 13 · books.search del contenedor pide la caché con una clave normalizada", () => {
  it.each([["Dune"], ["dune"], [" DUNE "], ["\tDune\n"], ["DUNE"]])("«%s» se pide como «dune»", async (q) => {
    await getContainer().books.search(q, undefined);

    expect(lastCall()[0]).toBe("dune");
  });

  it("Dune, dune y ' DUNE ' comparten exactamente los mismos argumentos", async () => {
    const calls: [string, number | undefined][] = [];
    for (const q of ["Dune", "dune", " DUNE "]) {
      await getContainer().books.search(q, 5);
      calls.push(lastCall());
    }

    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
  });

  it("los espacios internos repetidos se colapsan", async () => {
    await getContainer().books.search("  Don    Quijote  de   La Mancha ", undefined);

    expect(lastCall()[0]).toBe("don quijote de la mancha");
  });

  it("un texto vacío o solo de espacios se pide como cadena vacía", async () => {
    await getContainer().books.search("   ", undefined);

    expect(lastCall()[0]).toBe("");
  });

  it("devuelve lo que devuelve la función cacheada", async () => {
    const found: Book[] = [{ ...aBook({ title: "Dune" }), id: "b-1", available: 1 }];
    cache.searchBooksCached.mockResolvedValueOnce(found);

    expect(await getContainer().books.search("Dune")).toBe(found);
  });
});

describe("S1 regla 13 · limit normalizado", () => {
  it("sin limit se pide undefined (todos los resultados, como en F2)", async () => {
    await getContainer().books.search("dune");

    expect(lastCall()[1]).toBeUndefined();
  });

  it.each([1, 10, 50])("un limit válido (%i) se conserva", async (limit) => {
    await getContainer().books.search("dune", limit);

    expect(lastCall()[1]).toBe(limit);
  });

  it.each([
    ["0", 0],
    ["negativo", -3],
    ["mayor que 50", 51],
    ["enorme", 1_000_000],
    ["decimal", 2.7],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
  ])("un limit %s se normaliza a undefined o a un entero entre 1 y 50", async (_name, limit) => {
    await getContainer().books.search("dune", limit);

    const normalized = lastCall()[1];
    if (normalized === undefined) {
      return;
    }
    expect(Number.isInteger(normalized)).toBe(true);
    expect(normalized).toBeGreaterThanOrEqual(1);
    expect(normalized).toBeLessThanOrEqual(50);
  });
});

function record(id: string, title: string, author: string): BookRecord {
  return { ...aBook({ title, author }), id };
}

describe("S1 regla 13 · filterBooks da el mismo resultado al normalizar el texto", () => {
  const books = [
    record("b-1", "Dune", "Frank Herbert"),
    record("b-2", "Cien   años de soledad", "Gabriel García Márquez"),
    record("b-3", "El nombre del viento", "Patrick Rothfuss"),
  ];
  const ids = (found: BookRecord[]) => found.map((book) => book.id);

  it("Dune, dune y ' DUNE ' encuentran lo mismo", () => {
    const reference = ids(filterBooks(books, "dune"));

    expect(reference).toEqual(["b-1"]);
    expect(ids(filterBooks(books, "Dune"))).toEqual(reference);
    expect(ids(filterBooks(books, " DUNE "))).toEqual(reference);
  });

  it("espacios múltiples y mayúsculas en la consulta no cambian el resultado", () => {
    expect(ids(filterBooks(books, "  CIEN    años  "))).toEqual(["b-2"]);
    expect(ids(filterBooks(books, "cien años"))).toEqual(["b-2"]);
  });

  it("espacios repetidos en el título tampoco impiden la coincidencia", () => {
    expect(ids(filterBooks(books, "cien años de soledad"))).toEqual(["b-2"]);
  });

  it("busca también en el autor sin distinguir mayúsculas", () => {
    expect(ids(filterBooks(books, "  frank   HERBERT"))).toEqual(["b-1"]);
  });

  it("el limit se aplica igual con la consulta normalizada", () => {
    expect(ids(filterBooks(books, "  E  ", 1))).toHaveLength(1);
  });
});
