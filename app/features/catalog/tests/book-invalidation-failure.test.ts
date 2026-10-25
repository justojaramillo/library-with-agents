import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { BookSchema } from "../schema";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { invalidateBooksCache } from "@/features/container";
import { POST as createBookRoute } from "@/api/books/route";

/** S1 regla 14: si `revalidateTag` lanza, lo ya guardado sigue respondiendo bien y el log solo lleva el nombre. */
class RevalidateBrokenError extends Error {
  override name = "RevalidateBrokenError";
  secret = "VALOR-SECRETO-DE-LA-PETICION";
}

const holder = vi.hoisted(() => ({ world: null as World | null, revalidateTag: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: holder.revalidateTag, cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "cookie-valida" }) }) }));
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({ verifySessionCookie: async () => ({ uid: "uid-1" }) }),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: "BIBLIOTECARIO", active: true }) }),
      }),
    }),
  }),
}));
// Se conserva el `invalidateBooksCache` real del contenedor; solo se sustituye cómo se obtienen los servicios.
vi.mock("@/features/container", async (importActual) => {
  const actual = await importActual<typeof import("@/features/container")>();
  return {
    ...actual,
    getContainer: () => {
      if (holder.world === null) {
        throw new Error("la prueba no preparó el mundo");
      }
      return { books: holder.world.books };
    },
  };
});

let logSpy: MockInstance<Console["error"]>;

/** Todo lo que se escribió en el log, con los objetos desplegados (pila y propiedades incluidas). */
function loggedText(): string {
  return logSpy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")).join("\n");
}

beforeEach(() => {
  holder.world = makeWorld();
  holder.revalidateTag.mockReset();
  holder.revalidateTag.mockImplementation(() => {
    throw new RevalidateBrokenError("fallo de la caché con datos internos");
  });
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("S1 regla 14 · invalidateBooksCache no lanza", () => {
  it("si revalidateTag lanza, la llamada termina sin error", () => {
    expect(() => invalidateBooksCache()).not.toThrow();
    expect(holder.revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("el log lleva el nombre del error y nada más: ni mensaje, ni propiedades, ni pila", () => {
    invalidateBooksCache();

    const text = loggedText();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(text).toContain("RevalidateBrokenError");
    expect(text).not.toContain("fallo de la caché con datos internos");
    expect(text).not.toContain("VALOR-SECRETO-DE-LA-PETICION");
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("si no falla, no registra nada", () => {
    holder.revalidateTag.mockReset();

    invalidateBooksCache();

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("S1 regla 14 · POST /api/books con la invalidación rota", () => {
  it("el libro ya guardado responde 201 y no 500", async () => {
    const input = aBook({ title: "Rayuela" });

    const response = await createBookRoute(
      new NextRequest("http://localhost/api/books", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(input),
      }),
    );

    expect(response.status).toBe(201);
    expect(BookSchema.parse(await response.json()).title).toBe("Rayuela");
    expect(holder.revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("el libro quedó guardado aunque la caché no se pudo invalidar", async () => {
    const input = aBook({ title: "Rayuela" });

    await createBookRoute(
      new NextRequest("http://localhost/api/books", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(input),
      }),
    );

    expect((await world().books.search("rayuela")).map((book) => book.title)).toEqual(["Rayuela"]);
  });
});

function world(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}
