import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/shared/schema";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { POST as createBookRoute } from "@/api/books/route";

type Session = { cookie: string | undefined; role: Role };

const holder = vi.hoisted(() => ({
  world: null as World | null,
  invalidate: vi.fn(),
  session: { cookie: undefined, role: "BIBLIOTECARIO" } as Session,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => {
      if (holder.session.cookie === undefined) {
        return undefined;
      }
      return { value: holder.session.cookie };
    },
  }),
}));

vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({ verifySessionCookie: async () => ({ uid: "uid-1" }) }),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ role: holder.session.role, active: true }) }),
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
  invalidateBooksCache: holder.invalidate,
}));

function signInAs(role: Role) {
  holder.session = { cookie: "cookie-valida", role };
}

function post(body: object, headers: Record<string, string> = {}) {
  return createBookRoute(
    new NextRequest("http://localhost/api/books", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  holder.world = makeWorld();
  holder.invalidate.mockClear();
  holder.session = { cookie: undefined, role: "BIBLIOTECARIO" };
});

describe("POST /api/books · invalidación de la caché del catálogo (S1 regla 5)", () => {
  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("un libro creado por %s (201) invalida la etiqueta una vez", async (role) => {
    signInAs(role);

    const response = await post(aBook({ title: "Rayuela" }));

    expect(response.status).toBe(201);
    expect(holder.invalidate).toHaveBeenCalledTimes(1);
  });

  it("un cuerpo inválido (400) no invalida", async () => {
    signInAs("BIBLIOTECARIO");

    const response = await post({ title: "" });

    expect(response.status).toBe(400);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("un ISBN repetido (409) no invalida", async () => {
    signInAs("BIBLIOTECARIO");
    const book = aBook({ title: "Rayuela" });
    expect((await post(book)).status).toBe(201);
    holder.invalidate.mockClear();

    const response = await post({ ...book, title: "Otro título" });

    expect(response.status).toBe(409);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("un %s (403) no invalida", async (role) => {
    signInAs(role);

    const response = await post(aBook());

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("sin sesión (401) no invalida", async () => {
    const response = await post(aBook());

    expect(response.status).toBe(401);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("una petición de otro origen (403) no invalida", async () => {
    signInAs("BIBLIOTECARIO");

    const response = await post(aBook(), { "sec-fetch-site": "cross-site" });

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });
});
