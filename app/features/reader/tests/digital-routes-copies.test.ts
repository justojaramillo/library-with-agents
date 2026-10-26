import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { routeHolder, resetRouteHolder, signInAs } from "@/tests/helpers/digital-route-state";
import { errorOf, getInfo, patchCopies, patchCopiesRaw, type Json } from "@/tests/helpers/digital-route-calls";
import { DigitalInfoSchema } from "../schema";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

beforeEach(() => {
  resetRateLimits();
  resetRouteHolder();
  signInAs("BIBLIOTECARIO");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function storedCopies(): Promise<number | undefined> {
  return (await routeHolder.world.books.find("libro-1"))?.digital_copies;
}

describe("F27 · PATCH /api/books/:id/digital/copies · valores válidos", () => {
  it.each([0, 1, 50, 100])("fijar %i copias responde 200 con el estado actualizado", async (n) => {
    const response = await patchCopies("libro-1", { digital_copies: n });

    expect(response.status).toBe(200);
    const info = DigitalInfoSchema.parse(await response.json());
    expect(info).toMatchObject({ book_id: "libro-1", title: "Rayuela", digital_copies: n, has_content: false });
    expect(await storedCopies()).toBe(n);
  });

  it("el cambio se ve en la consulta GET posterior", async () => {
    await patchCopies("libro-1", { digital_copies: 7 });

    const info = DigitalInfoSchema.parse(await (await getInfo("libro-1")).json());

    expect(info.digital_copies).toBe(7);
  });

  it("fijar el mismo valor actual es idempotente (200)", async () => {
    expect((await patchCopies("libro-1", { digital_copies: 2 })).status).toBe(200);
    expect((await patchCopies("libro-1", { digital_copies: 2 })).status).toBe(200);
    expect(await storedCopies()).toBe(2);
  });

  it("un libro sin campos digitales parte de 0 copias", async () => {
    routeHolder.world.books.addBook({ id: "libro-viejo", title: "Ficciones" });

    const before = DigitalInfoSchema.parse(await (await getInfo("libro-viejo")).json());
    const after = await patchCopies("libro-viejo", { digital_copies: 4 });

    expect(before).toMatchObject({ digital_copies: 0, has_content: false });
    expect(DigitalInfoSchema.parse(await after.json()).digital_copies).toBe(4);
  });

  it("campos de más en el cuerpo se ignoran: la identidad sale de la sesión", async () => {
    const response = await patchCopies("libro-1", { digital_copies: 3, member_id: "otra-persona", title: "Hackeado" });

    expect(response.status).toBe(200);
    expect(DigitalInfoSchema.parse(await response.json()).title).toBe("Rayuela");
  });
});

describe("F27 · PATCH /api/books/:id/digital/copies · valores inválidos (400)", () => {
  const INVALID: [string, Json][] = [
    ["−1", { digital_copies: -1 }],
    ["101", { digital_copies: 101 }],
    ["1.5", { digital_copies: 1.5 }],
    ["texto «3»", { digital_copies: "3" }],
    ["null", { digital_copies: null }],
    ["ausente", {}],
    ["booleano", { digital_copies: true }],
    ["lista", { digital_copies: [3] }],
    ["un número a secas", 3],
    ["una lista", []],
    ["null a secas", null],
  ];

  it.each(INVALID)("%s responde 400 y nada cambia", async (_name, body) => {
    const response = await patchCopies("libro-1", body);

    expect(response.status).toBe(400);
    expect(await storedCopies()).toBe(2);
  });

  it.each(["", "no es json", "{ digital_copies: 3", "{}}"])("el cuerpo %j responde 400", async (raw) => {
    const response = await patchCopiesRaw("libro-1", raw);

    expect(response.status).toBe(400);
    expect(await storedCopies()).toBe(2);
  });

  it("una petición sin cuerpo responde 400", async () => {
    expect((await patchCopiesRaw("libro-1", null)).status).toBe(400);
  });
});

describe("F27 · PATCH /api/books/:id/digital/copies · préstamos activos", () => {
  beforeEach(() => {
    routeHolder.world.activeLoans.setActive("libro-1", 3);
  });

  it("dejar menos copias que préstamos activos responde 409 con el texto de la regla y nada cambia", async () => {
    const response = await patchCopies("libro-1", { digital_copies: 2 });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("No puedes dejar menos copias digitales que préstamos digitales activos (3).");
    expect(await storedCopies()).toBe(2);
  });

  it("fijar exactamente las copias activas responde 200", async () => {
    expect((await patchCopies("libro-1", { digital_copies: 3 })).status).toBe(200);
    expect(await storedCopies()).toBe(3);
  });

  it("poner 0 con préstamos activos responde 409", async () => {
    expect((await patchCopies("libro-1", { digital_copies: 0 })).status).toBe(409);
  });

  it("subir las copias con préstamos activos responde 200", async () => {
    expect((await patchCopies("libro-1", { digital_copies: 10 })).status).toBe(200);
  });
});

describe("F27 · PATCH /api/books/:id/digital/copies · contenido existente", () => {
  it("poner 0 copias conserva el contenido", async () => {
    routeHolder.world.books.addBook({
      id: "libro-2",
      title: "Con texto",
      digital_copies: 1,
      content: { path: "books/libro-2/c.md", bytes: 12, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    const response = await patchCopies("libro-2", { digital_copies: 0 });

    expect(DigitalInfoSchema.parse(await response.json())).toMatchObject({
      digital_copies: 0,
      has_content: true,
      content_bytes: 12,
    });
  });
});
