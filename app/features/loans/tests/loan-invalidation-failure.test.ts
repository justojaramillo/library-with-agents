import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Role } from "@/shared/schema";
import { requireUser } from "@/shared/server/http";
import { makeLoanWorld, NOW, type LoanWorld } from "@/tests/helpers/loans";
import { LoanSchema, ReturnResultSchema } from "../schema";
import { POST as lendRoute } from "@/api/loans/route";
import { POST as returnRoute } from "@/api/loans/[id]/return/route";

/** S1 regla 14: si `revalidateTag` lanza, el préstamo y la devolución ya guardados siguen respondiendo bien. */
class RevalidateBrokenError extends Error {
  override name = "RevalidateBrokenError";
}

const holder = vi.hoisted(() => ({ world: null as LoanWorld | null, revalidateTag: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: holder.revalidateTag, cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({}),
  getAdminDb: () => ({ collection: () => ({}) }),
}));
vi.mock("@/shared/server/http", async (importActual) => {
  const actual = await importActual<typeof import("@/shared/server/http")>();
  return { ...actual, requireUser: vi.fn(actual.requireUser) };
});
// Se conserva el `invalidateBooksCache` real del contenedor; solo se sustituye cómo se obtienen los servicios.
vi.mock("@/features/container", async (importActual) => {
  const actual = await importActual<typeof import("@/features/container")>();
  return {
    ...actual,
    getContainer: () => {
      if (holder.world === null) {
        throw new Error("la prueba no preparó el mundo de préstamos");
      }
      return { loans: holder.world.service };
    },
  };
});

let logSpy: MockInstance<Console["error"]>;

function currentWorld(): LoanWorld {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

function post(url: string, body?: object) {
  if (body === undefined) {
    return new NextRequest(url, { method: "POST", headers: { "sec-fetch-site": "same-origin" } });
  }
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function signInAs(member: { id: string; role: Role }) {
  vi.mocked(requireUser).mockResolvedValueOnce({ member_id: member.id, role: member.role });
}

beforeEach(() => {
  holder.world = makeLoanWorld();
  holder.revalidateTag.mockReset();
  holder.revalidateTag.mockImplementation(() => {
    throw new RevalidateBrokenError("detalle interno de la caché");
  });
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  logSpy.mockRestore();
  vi.useRealTimers();
});

describe("S1 regla 14 · préstamos y devoluciones con la invalidación rota", () => {
  it("POST /api/loans sigue respondiendo 201 con el préstamo creado", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(librarian);

    const response = await lendRoute(post("http://localhost/api/loans", { member_id: student.id, book_id: book.id }));

    expect(response.status).toBe(201);
    expect(LoanSchema.parse(await response.json()).member_id).toBe(student.id);
    expect(holder.revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("POST /api/loans/:id/return sigue respondiendo 200 con la devolución hecha", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    const loan = await w.seedLoan(student.id, book.id);
    signInAs(librarian);

    const response = await returnRoute(post(`http://localhost/api/loans/${loan.id}/return`), {
      params: Promise.resolve({ id: loan.id }),
    });

    expect(response.status).toBe(200);
    expect(ReturnResultSchema.parse(await response.json()).loan.returned_at).not.toBeNull();
    expect(holder.revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("el log solo lleva el nombre del error, no su mensaje", async () => {
    const w = currentWorld();
    const librarian = await w.addMember("BIBLIOTECARIO");
    const student = await w.addMember("ESTUDIANTE");
    const book = await w.addBook(1);
    signInAs(librarian);

    await lendRoute(post("http://localhost/api/loans", { member_id: student.id, book_id: book.id }));

    const text = logSpy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")).join("\n");
    expect(text).toContain("RevalidateBrokenError");
    expect(text).not.toContain("detalle interno de la caché");
  });
});
