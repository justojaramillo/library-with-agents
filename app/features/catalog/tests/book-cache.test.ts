import { beforeEach, describe, expect, it, vi } from "vitest";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import type { Book } from "../schema";
import { BOOKS_CACHE_TAG, registerBookSearch, searchBooksCached } from "../server/book-search-cache";
import { invalidateBooksCache } from "@/features/container";

const next = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => next);
// El contenedor se importa para probar `invalidateBooksCache`; construirlo (`getContainer`) sí necesitaría Firebase.
vi.mock("@/shared/server/firebase", () => ({ getAdminAuth: () => ({}), getAdminDb: () => ({}) }));

beforeEach(() => {
  next.revalidateTag.mockClear();
  next.cacheLife.mockClear();
  next.cacheTag.mockClear();
});

describe("S1 · caché del catálogo (ADR-0008): lo que se puede probar sin ejecutar Next", () => {
  it("la etiqueta de la caché es «books»", () => {
    expect(BOOKS_CACHE_TAG).toBe("books");
  });

  it("invalidateBooksCache invalida la etiqueta «books» de inmediato (expire: 0)", () => {
    invalidateBooksCache();

    expect(next.revalidateTag).toHaveBeenCalledTimes(1);
    expect(next.revalidateTag).toHaveBeenCalledWith("books", { expire: 0 });
  });

  it("la búsqueda cacheada tiene la misma firma que la del servicio de libros", () => {
    const search: World["books"]["search"] = searchBooksCached;

    expect(typeof search).toBe("function");
  });

  it("la búsqueda cacheada delega en la búsqueda registrada con q y limit y devuelve su resultado", async () => {
    const world = makeWorld();
    await world.books.create(aBook({ title: "Rayuela", copies: 2 }));
    registerBookSearch(world.books.search);

    const found: Book[] = await searchBooksCached("rayuela", 5);

    expect(found.map((book) => book.title)).toEqual(["Rayuela"]);
    expect(found[0]).toMatchObject({ copies: 2, available: 2 });
  });

  it("sin limit se comporta como la búsqueda de F2 (todos los que coinciden)", async () => {
    const world = makeWorld();
    for (let i = 0; i < 60; i += 1) {
      await world.books.create(aBook({ title: `Cuento ${i}` }));
    }
    registerBookSearch(world.books.search);

    expect(await searchBooksCached("cuento")).toHaveLength(60);
    expect(await searchBooksCached("cuento", 11)).toHaveLength(11);
  });

  it("pasa exactamente los argumentos recibidos a la búsqueda registrada", async () => {
    const calls: [string, number | undefined][] = [];
    registerBookSearch(async (q, limit) => {
      calls.push([q, limit]);
      return [];
    });

    await searchBooksCached("abc", 7);
    await searchBooksCached("", undefined);

    expect(calls).toEqual([
      ["abc", 7],
      ["", undefined],
    ]);
  });

  it("declara la política de la spec: 60 s de revalidación, 120 s de expiración y la etiqueta «books»", async () => {
    registerBookSearch(async () => []);

    await searchBooksCached("x");

    expect(next.cacheLife).toHaveBeenCalledWith({ revalidate: 60, expire: 120 });
    expect(next.cacheTag).toHaveBeenCalledWith("books");
  });
});
