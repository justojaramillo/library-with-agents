import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { requireUser } from "@/shared/server/http";
import { makeLoanWorld, NOW, type LoanWorld } from "@/tests/helpers/loans";
import { LoanSchema, OverdueLoanSchema, ReturnResultSchema } from "../schema";
import { POST as lendRoute } from "@/api/loans/route";
import { POST as returnRoute } from "@/api/loans/[id]/return/route";
import { GET as overdueRoute } from "@/api/members/[id]/overdue/route";

const holder = vi.hoisted(() => ({ world: null as LoanWorld | null }));

vi.mock("server-only", () => ({}));

// Sin sesión se ejecuta el `requireUser` real (con una cookie vacía); con sesión se sustituye una sola vez.
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
  // S1: las rutas invalidan la caché del catálogo; aquí no se comprueba (ver loan-routes-cache.test.ts).
  invalidateBooksCache: () => undefined,
}));

const sameOriginJson = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

function post(url: string, body?: object) {
  const headers = { ...sameOriginJson };
  if (body === undefined) {
    return new NextRequest(url, { method: "POST", headers: { "sec-fetch-site": "same-origin" } });
  }
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}
const idContext = (id: string) => ({ params: Promise.resolve({ id }) });

function signInAs(member: {
  id: string;
  role: "EXTERNO" | "ESTUDIANTE" | "DOCENTE" | "BIBLIOTECARIO" | "ADMINISTRADOR";
}) {
  vi.mocked(requireUser).mockResolvedValueOnce({ member_id: member.id, role: member.role });
}

beforeEach(() => {
  holder.world = makeLoanWorld();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function currentWorld(): LoanWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

describe("POST /api/loans (F5)", () => {
  it("sin sesión responde 401", async () => {
    const response = await lendRoute(post("http://localhost/api/loans", { member_id: "m1", book_id: "b1" }));
    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(await response.json()).error.length).toBeGreaterThan(0);
  });

  it("una petición de otro origen se rechaza con 403 antes de mirar la sesión", async () => {
    const request = new NextRequest("http://localhost/api/loans", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ member_id: "m1", book_id: "b1" }),
    });

    const response = await lendRoute(request);

    expect(response.status).toBe(403);
  });

  it("el bibliotecario presta y recibe 201 con el préstamo", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: student.id, book_id: book.id }));

    expect(response.status).toBe(201);
    const loan = LoanSchema.parse(await response.json());
    expect(loan.due_at).toBe("2026-01-30T10:00:00.000Z");
    expect(loan.returned_at).toBeNull();
  });

  it("un prestatario pide a nombre de otra persona: 403", async () => {
    const w = currentWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(ana);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: luis.id, book_id: book.id }));

    expect(response.status).toBe(403);
  });

  it("un campo extra como role o due_at se ignora: el plazo sale del rol de la cuenta", async () => {
    const w = currentWorld();
    const external = await w.addMember("EXTERNO");
    const book = await w.addBook(1);
    signInAs(external);

    const response = await lendRoute(
      post("http://localhost/api/loans", {
        member_id: external.id,
        book_id: book.id,
        role: "DOCENTE",
        due_at: "2099-01-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(201);
    expect(LoanSchema.parse(await response.json()).due_at).toBe("2026-01-25T10:00:00.000Z");
  });

  it.each([
    ["ids vacíos", { member_id: "", book_id: "" }],
    ["falta book_id", { member_id: "m1" }],
    ["falta member_id", { book_id: "b1" }],
    ["cuerpo vacío", {}],
  ])("%s: 400", async (_name, body) => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", body));

    expect(response.status).toBe(400);
  });

  it("una cuenta o un libro inexistente: 404", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    signInAs(librarian);

    const response = await lendRoute(
      post("http://localhost/api/loans", { member_id: student.id, book_id: "no-existe" }),
    );

    expect(response.status).toBe(404);
  });

  it("sin ejemplares libres: 409", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(ana.id, book.id);
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: luis.id, book_id: book.id }));

    expect(response.status).toBe(409);
  });
});

describe("POST /api/loans/:id/return (F6)", () => {
  it("sin sesión responde 401", async () => {
    const response = await returnRoute(post("http://localhost/api/loans/l1/return"), idContext("l1"));
    expect(response.status).toBe(401);
  });

  it("el bibliotecario devuelve: 200 con el préstamo cerrado y la multa", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id, {
      due_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    });
    signInAs(librarian);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(response.status).toBe(200);
    const result = ReturnResultSchema.parse(await response.json());
    expect(result.loan.returned_at).toBe(NOW.toISOString());
    expect(result.fine_cop).toBe(1000);
  });

  it("un prestatario no puede devolver: 403", async () => {
    const w = currentWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(student);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(response.status).toBe(403);
  });

  it("préstamo inexistente: 404; ya devuelto: 409", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id, { returned_at: NOW.toISOString() });
    signInAs(librarian);
    const missing = await returnRoute(post("http://localhost/api/loans/zzz/return"), idContext("zzz"));
    signInAs(librarian);
    const twice = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id));

    expect(missing.status).toBe(404);
    expect(twice.status).toBe(409);
  });

  it("dos devoluciones simultáneas del mismo préstamo: una responde 200 y la otra 409", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(librarian);
    signInAs(librarian);

    const responses = await Promise.all([
      returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id)),
      returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), idContext(loan.id)),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await w.repos.loans.findById(loan.id))?.returned_at).toBe(NOW.toISOString());
  });
});

describe("GET /api/members/:id/overdue (F8)", () => {
  const get = (id: string) => new NextRequest(`http://localhost/api/members/${id}/overdue`);

  it("sin sesión responde 401", async () => {
    const response = await overdueRoute(get("m1"), idContext("m1"));
    expect(response.status).toBe(401);
  });

  it("el prestatario ve sus vencidos: 200 con la lista", async () => {
    const w = currentWorld();
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    await w.seedLoan(student.id, book.id, { due_at: new Date(NOW.getTime() - 86_400_000).toISOString() });
    signInAs(student);

    const response = await overdueRoute(get(student.id), idContext(student.id));

    expect(response.status).toBe(200);
    const list = OverdueLoanSchema.array().parse(await response.json());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ days_late: 1, fine_cop: 500 });
  });

  it("puede ser una lista vacía", async () => {
    const w = currentWorld();
    const student = await w.addMember("ESTUDIANTE");
    signInAs(student);

    const response = await overdueRoute(get(student.id), idContext(student.id));

    expect(response.status).toBe(200);
    expect(OverdueLoanSchema.array().parse(await response.json())).toEqual([]);
  });

  it("el personal consulta a cualquiera; una cuenta inexistente da 404", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    signInAs(librarian);
    const found = await overdueRoute(get(student.id), idContext(student.id));
    signInAs(librarian);
    const missing = await overdueRoute(get("no-existe"), idContext("no-existe"));

    expect(found.status).toBe(200);
    expect(missing.status).toBe(404);
  });

  it("un prestatario que consulta a otra persona, exista o no: 403", async () => {
    const w = currentWorld();
    const ana = await w.addMember("ESTUDIANTE");
    const luis = await w.addMember("ESTUDIANTE");
    signInAs(ana);
    const existing = await overdueRoute(get(luis.id), idContext(luis.id));
    signInAs(ana);
    const missing = await overdueRoute(get("no-existe"), idContext("no-existe"));

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
  });
});
