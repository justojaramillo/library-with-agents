import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookSchema, CreateBookInputSchema } from "@/features/catalog/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { GET as booksRoute } from "@/api/books/route";

const holder = vi.hoisted(() => ({ world: null as World | null }));

vi.mock("server-only", () => ({}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { books: holder.world.books };
  },
}));

const DIGITAL_KEYS = ["digital_copies", "content_path", "content_bytes", "content_updated_at", "has_content"];

beforeEach(async () => {
  resetRateLimits();
  holder.world = makeWorld();
  await holder.world.books.create(aBook({ title: "Rayuela", author: "Julio Cortázar", copies: 3 }));
});

describe("F27 · El catálogo no cambia con los campos digitales", () => {
  it("GET /api/books devuelve los mismos campos de siempre y ninguno digital", async () => {
    const response = await booksRoute(new NextRequest("http://localhost/api/books?q=rayuela"));

    expect(response.status).toBe(200);
    const books = BookSchema.array().parse(await response.json());
    expect(books).toHaveLength(1);
    expect(Object.keys(books[0] ?? {}).sort()).toEqual(["author", "available", "copies", "id", "isbn", "title"]);
    const text = JSON.stringify(books);
    for (const key of DIGITAL_KEYS) {
      expect(text).not.toContain(key);
    }
  });

  it("la búsqueda con límite devuelve lo mismo que antes", async () => {
    const response = await booksRoute(new NextRequest("http://localhost/api/books?q=cort&limit=11"));

    const books = BookSchema.array().parse(await response.json());
    expect(books.map((book) => book.title)).toEqual(["Rayuela"]);
    expect(books[0]?.copies).toBe(3);
    expect(books[0]?.available).toBe(3);
  });

  it("un documento de libro con campos digitales se lee como un libro normal (los campos extra se descartan)", () => {
    const parsed = BookSchema.parse({
      id: "libro-1",
      isbn: "9788437604947",
      title: "Rayuela",
      author: "Julio Cortázar",
      copies: 3,
      available: 3,
      digital_copies: 5,
      content_path: "books/libro-1/content-abc.md",
      content_bytes: 1024,
      content_updated_at: "2026-03-01T08:00:00.000Z",
    });

    expect(Object.keys(parsed).sort()).toEqual(["author", "available", "copies", "id", "isbn", "title"]);
  });

  it("registrar un libro (F1) sigue sin pedir ni aceptar campos digitales", () => {
    const parsed = CreateBookInputSchema.parse({
      isbn: "9788437604947",
      title: "Rayuela",
      author: "Julio Cortázar",
      copies: 3,
      digital_copies: 5,
    });

    expect(Object.keys(parsed).sort()).toEqual(["author", "copies", "isbn", "title"]);
  });
});
