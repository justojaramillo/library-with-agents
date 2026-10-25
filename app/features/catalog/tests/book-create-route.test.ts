import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema, type Role } from "@/shared/schema";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { BookSchema } from "../schema";
import { POST as createBookRoute } from "@/api/books/route";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const holder = vi.hoisted(() => ({
  world: null as World | null,
  role: null as string | null,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.role === null) {
        return undefined;
      }
      return { value: "cookie-valida" };
    },
  }),
}));

vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({ verifySessionCookie: async () => ({ uid: "uid-1" }) }),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: holder.role, active: true }) }),
      }),
    }),
  }),
}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { books: holder.world.books };
  },
  invalidateBooksCache: () => undefined,
}));

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

function signInAs(role: Role): void {
  holder.role = role;
}

function post(body: Json) {
  return createBookRoute(
    new NextRequest("http://localhost/api/books", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(body),
    }),
  );
}

async function catalogSize(): Promise<number> {
  return (await currentWorld().books.search("")).length;
}

beforeEach(() => {
  holder.world = makeWorld();
  holder.role = null;
});

describe("F36 · POST /api/books sigue como en F1 · caso feliz", () => {
  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("%s registra un libro: 201 con available = copies", async (role) => {
    signInAs(role);

    const response = await post({ isbn: "9788437604947", title: "Rayuela", author: "Julio Cortázar", copies: 3 });

    expect(response.status).toBe(201);
    const book = BookSchema.parse(await response.json());
    expect(book).toMatchObject({
      isbn: "9788437604947",
      title: "Rayuela",
      author: "Julio Cortázar",
      copies: 3,
      available: 3,
    });
  });

  it("el libro registrado aparece en la búsqueda pública", async () => {
    signInAs("BIBLIOTECARIO");
    await post({ isbn: "9788437604947", title: "Rayuela", author: "Julio Cortázar", copies: 1 });

    const found = await currentWorld().books.search("rayuela");

    expect(found.map((book) => book.isbn)).toEqual(["9788437604947"]);
  });

  it("un ISBN de 10 dígitos también se acepta", async () => {
    signInAs("BIBLIOTECARIO");

    expect((await post(aBook({ isbn: "8437604947" }))).status).toBe(201);
  });

  it("el título y el autor se guardan recortados", async () => {
    signInAs("BIBLIOTECARIO");

    const response = await post(aBook({ title: "  Rayuela  ", author: "  Julio Cortázar  " }));

    expect(response.status).toBe(201);
    expect(BookSchema.parse(await response.json())).toMatchObject({ title: "Rayuela", author: "Julio Cortázar" });
  });
});

describe("F36 · POST /api/books · bordes de los campos (400 / 201)", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it.each([
    ["ISBN de 9 dígitos", { isbn: "123456789" }, 400],
    ["ISBN de 10 dígitos", { isbn: "1234567890" }, 201],
    ["ISBN de 13 dígitos", { isbn: "1234567890123" }, 201],
    ["ISBN de 14 dígitos", { isbn: "12345678901234" }, 400],
    ["ISBN con letras", { isbn: "12345678AB" }, 400],
    ["ISBN vacío", { isbn: "" }, 400],
    ["título vacío", { title: "" }, 400],
    ["título solo con espacios", { title: "   " }, 400],
    ["título de 1 carácter", { title: "a" }, 201],
    ["título de 200 caracteres", { title: "a".repeat(200) }, 201],
    ["título de 201 caracteres", { title: "a".repeat(201) }, 400],
    ["autor de 120 caracteres", { author: "a".repeat(120) }, 201],
    ["autor de 121 caracteres", { author: "a".repeat(121) }, 400],
    ["autor vacío", { author: "" }, 400],
    ["0 ejemplares", { copies: 0 }, 400],
    ["1 ejemplar", { copies: 1 }, 201],
    ["100 ejemplares", { copies: 100 }, 201],
    ["101 ejemplares", { copies: 101 }, 400],
    ["1,5 ejemplares", { copies: 1.5 }, 400],
    ["ejemplares como texto", { copies: "abc" }, 400],
    ["ejemplares como texto numérico", { copies: "2" }, 400],
  ])("%s → %s", async (_nombre, over, status) => {
    const response = await post({ ...aBook(), ...over });

    expect(response.status).toBe(status);
  });

  it("un ISBN con guiones directo a la API da 400 y no registra nada", async () => {
    const response = await post({ ...aBook(), isbn: "978-84-376-0494-7" });

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(await catalogSize()).toBe(0);
  });

  it("un ISBN con espacios directo a la API da 400", async () => {
    expect((await post({ ...aBook(), isbn: "978 84 376 0494 7" })).status).toBe(400);
  });

  it("un cuerpo sin campos da 400", async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe("F36 · POST /api/books · ISBN repetido (409)", () => {
  it("el segundo registro del mismo ISBN da 409 y el catálogo no cambia", async () => {
    signInAs("BIBLIOTECARIO");
    const book = aBook({ title: "Rayuela" });
    expect((await post(book)).status).toBe(201);

    const response = await post({ ...book, title: "Otro título", copies: 5 });

    expect(response.status).toBe(409);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    const found = await currentWorld().books.search("");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "Rayuela", copies: 1 });
  });

  it("dos registros simultáneos del mismo ISBN: uno 201 y el otro 409", async () => {
    signInAs("BIBLIOTECARIO");
    const book = aBook();

    const statuses = (await Promise.all([post(book), post(book)])).map((response) => response.status).sort();

    expect(statuses).toEqual([201, 409]);
    expect(await catalogSize()).toBe(1);
  });
});

describe("F36 · POST /api/books · autorización", () => {
  it("sin sesión responde 401 y no registra nada", async () => {
    const response = await post(aBook());

    expect(response.status).toBe(401);
    expect(await catalogSize()).toBe(0);
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 y no registra nada", async (role) => {
    signInAs(role);

    const response = await post(aBook());

    expect(response.status).toBe(403);
    expect(await catalogSize()).toBe(0);
  });

  it("un cuerpo inválido de un prestatario responde 403: la autorización va primero", async () => {
    signInAs("ESTUDIANTE");

    expect((await post({})).status).toBe(403);
  });

  it("una petición de otro origen responde 403 aunque sea personal", async () => {
    signInAs("BIBLIOTECARIO");

    const response = await createBookRoute(
      new NextRequest("http://localhost/api/books", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: JSON.stringify(aBook()),
      }),
    );

    expect(response.status).toBe(403);
    expect(await catalogSize()).toBe(0);
  });
});
