import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { BookSchema } from "../schema";
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

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

async function addBooks(count: number, title = "Libro de prueba") {
  for (let i = 0; i < count; i += 1) {
    await currentWorld().books.create(aBook({ title: `${title} ${i}` }));
  }
}

function get(search: string) {
  return booksRoute(new NextRequest(`http://localhost/api/books${search}`));
}

beforeEach(() => {
  holder.world = makeWorld();
});

describe("GET /api/books?q=&limit= (F34: búsqueda acotada para sugerencias)", () => {
  it("es pública: sin sesión responde 200", async () => {
    await addBooks(1);

    expect((await get("?q=prueba")).status).toBe(200);
  });

  it("sin limit devuelve todos los que coinciden, como en F2 (más de 50)", async () => {
    await addBooks(60);

    const list = BookSchema.array().parse(await (await get("?q=prueba")).json());

    expect(list).toHaveLength(60);
  });

  it("sin q ni limit lista todo el catálogo, como en F2", async () => {
    await addBooks(3);

    const response = await get("");

    expect(response.status).toBe(200);
    expect(BookSchema.array().parse(await response.json())).toHaveLength(3);
  });

  it("limit=1 devuelve un solo libro que coincide con la búsqueda", async () => {
    await addBooks(3);
    await currentWorld().books.create(aBook({ title: "Otro tema distinto" }));

    const list = BookSchema.array().parse(await (await get("?q=prueba&limit=1")).json());

    expect(list).toHaveLength(1);
    expect(list[0].title).toContain("prueba");
  });

  it("limit=11 con 15 coincidencias devuelve 11 (lo que usa la pantalla para saber si hay más)", async () => {
    await addBooks(15);

    const list = BookSchema.array().parse(await (await get("?q=prueba&limit=11")).json());

    expect(list).toHaveLength(11);
  });

  it("limit=50 con 60 coincidencias devuelve 50", async () => {
    await addBooks(60);

    const response = await get("?q=prueba&limit=50");

    expect(response.status).toBe(200);
    expect(BookSchema.array().parse(await response.json())).toHaveLength(50);
  });

  it("con menos coincidencias que el límite devuelve solo las que hay", async () => {
    await addBooks(2);

    expect(BookSchema.array().parse(await (await get("?q=prueba&limit=50")).json())).toHaveLength(2);
  });

  it("sin coincidencias devuelve una lista vacía con 200", async () => {
    await addBooks(2);

    const response = await get("?q=inexistente&limit=5");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("limit=51 responde 400", async () => {
    const response = await get("?q=prueba&limit=51");

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each(["0", "-1", "abc", "2.5"])("limit=%s responde 400", async (limit) => {
    expect((await get(`?q=prueba&limit=${limit}`)).status).toBe(400);
  });

  it("los libros devueltos con limit conservan los ejemplares disponibles", async () => {
    await currentWorld().books.create(aBook({ title: "Rayuela", copies: 4 }));

    const list = BookSchema.array().parse(await (await get("?q=rayuela&limit=5")).json());

    expect(list[0]).toMatchObject({ title: "Rayuela", copies: 4, available: 4 });
  });
});
