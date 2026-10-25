import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/shared/server/http";
import { makeLoanWorld, NOW, type LoanWorld } from "@/tests/helpers/loans";
import { POST as lendRoute } from "@/api/loans/route";
import { POST as returnRoute } from "@/api/loans/[id]/return/route";

const holder = vi.hoisted(() => ({ world: null as LoanWorld | null, invalidate: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/http", async (importActual) => {
  const actual = await importActual<typeof import("@/shared/server/http")>();
  return { ...actual, requireUser: vi.fn(actual.requireUser) };
});

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo de préstamos");
    }
    return { loans: holder.world.service };
  },
  invalidateBooksCache: holder.invalidate,
}));

function post(url: string, body?: object, headers: Record<string, string> = {}) {
  if (body === undefined) {
    return new NextRequest(url, { method: "POST", headers: { "sec-fetch-site": "same-origin", ...headers } });
  }
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}
const idContext = (id: string) => ({ params: Promise.resolve({ id }) });

function signInAs(member: {
  id: string;
  role: "EXTERNO" | "ESTUDIANTE" | "DOCENTE" | "BIBLIOTECARIO" | "ADMINISTRADOR";
}) {
  vi.mocked(requireUser).mockResolvedValueOnce({ member_id: member.id, role: member.role });
}

function currentWorld(): LoanWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

beforeEach(() => {
  holder.world = makeLoanWorld();
  holder.invalidate.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/loans · invalidación de la caché del catálogo (S1 regla 5)", () => {
  it("un préstamo creado (201) invalida la etiqueta una vez, porque cambian los ejemplares disponibles", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: student.id, book_id: book.id }));

    expect(response.status).toBe(201);
    expect(holder.invalidate).toHaveBeenCalledTimes(1);
  });

  it("un prestatario que se presta a sí mismo (201) también invalida", async () => {
    const w = currentWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(student);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: student.id, book_id: book.id }));

    expect(response.status).toBe(201);
    expect(holder.invalidate).toHaveBeenCalledTimes(1);
  });

  it("un cuerpo inválido (400) no invalida", async () => {
    const w = currentWorld();
    signInAs(await w.addMember("BIBLIOTECARIO"));

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: "", book_id: "" }));

    expect(response.status).toBe(400);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("pedir a nombre de otra persona (403) no invalida", async () => {
    const w = currentWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(ana);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: luis.id, book_id: book.id }));

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("un libro inexistente (404) no invalida", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    signInAs(librarian);

    const response = await lendRoute(
      post("http://localhost/api/loans", { member_id: student.id, book_id: "no-existe" }),
    );

    expect(response.status).toBe(404);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("sin ejemplares libres (409) no invalida", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(ana.id, book.id);
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: luis.id, book_id: book.id }));

    expect(response.status).toBe(409);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("sin sesión (401) no invalida", async () => {
    const response = await lendRoute(post("http://localhost/api/loans", { member_id: "m1", book_id: "b1" }));

    expect(response.status).toBe(401);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("una petición de otro origen (403) no invalida", async () => {
    const response = await lendRoute(
      post("http://localhost/api/loans", { member_id: "m1", book_id: "b1" }, { "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });
});

describe("POST /api/loans/:id/return · invalidación de la caché del catálogo (S1 regla 5)", () => {
  it("una devolución correcta (200) invalida la etiqueta una vez", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(librarian);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(response.status).toBe(200);
    expect(holder.invalidate).toHaveBeenCalledTimes(1);
  });

  it("un prestatario no puede devolver (403) y no invalida", async () => {
    const w = currentWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(student);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("un préstamo inexistente (404) no invalida", async () => {
    const w = currentWorld();
    signInAs(await w.addMember("BIBLIOTECARIO"));

    const response = await returnRoute(post("http://localhost/api/loans/no-existe/return"), idContext("no-existe"));

    expect(response.status).toBe(404);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("devolver dos veces: la segunda (409) no invalida otra vez", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(librarian);
    expect((await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id))).status).toBe(
      200,
    );
    holder.invalidate.mockClear();
    signInAs(librarian);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(response.status).toBe(409);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("sin sesión (401) no invalida", async () => {
    const response = await returnRoute(post("http://localhost/api/loans/l1/return"), idContext("l1"));

    expect(response.status).toBe(401);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });

  it("una petición de otro origen (403) no invalida", async () => {
    const response = await returnRoute(
      post("http://localhost/api/loans/l1/return", undefined, { "sec-fetch-site": "cross-site" }),
      idContext("l1"),
    );

    expect(response.status).toBe(403);
    expect(holder.invalidate).not.toHaveBeenCalled();
  });
});
