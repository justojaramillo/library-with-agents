import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { routeHolder, resetRouteHolder, signInAs, signOut } from "@/tests/helpers/digital-route-state";
import {
  CROSS_SITE_JSON,
  errorOf,
  getInfo,
  patchCopies,
  patchCopiesRaw,
  putContent,
  putContentRaw,
} from "@/tests/helpers/digital-route-calls";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

type Call = { name: string; run: (id: string) => Promise<Response> };

const ROUTES: Call[] = [
  { name: "GET /digital", run: (id) => getInfo(id) },
  { name: "PATCH /digital/copies", run: (id) => patchCopies(id, { digital_copies: 3 }) },
  { name: "PUT /digital/content", run: (id) => putContent(id, "# Texto de prueba") },
];

const MUTATING: Call[] = [
  { name: "PATCH /digital/copies", run: (id) => patchCopies(id, { digital_copies: 3 }) },
  { name: "PUT /digital/content", run: (id) => putContent(id, "# Texto de prueba") },
];

beforeEach(() => {
  resetRateLimits();
  resetRouteHolder();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F27 · Rutas digitales · quién puede entrar", () => {
  it.each(ROUTES)("$name: sin sesión responde 401", async ({ run }) => {
    signOut();

    const response = await run("libro-1");

    expect(response.status).toBe(401);
  });

  it.each(ROUTES)("$name: el bibliotecario entra (200)", async ({ run }) => {
    signInAs("BIBLIOTECARIO");

    expect((await run("libro-1")).status).toBe(200);
  });

  it.each(ROUTES)("$name: el administrador entra (200)", async ({ run }) => {
    signInAs("ADMINISTRADOR");

    expect((await run("libro-1")).status).toBe(200);
  });

  describe.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("prestatario %s", (role) => {
    it.each(ROUTES)("$name: responde 403 y no cambia nada", async ({ run }) => {
      signInAs(role);

      const response = await run("libro-1");

      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("Solo para personal de la biblioteca");
      const book = await routeHolder.world.books.find("libro-1");
      expect(book?.digital_copies).toBe(2);
      expect(book?.content).toBeNull();
      expect(routeHolder.world.store.paths()).toEqual([]);
    });

    it.each(ROUTES)("$name: responde 403 aunque el :id esté mal formado", async ({ run }) => {
      signInAs(role);

      expect((await run("a/b")).status).toBe(403);
    });

    it.each(ROUTES)("$name: responde 403 aunque el libro no exista", async ({ run }) => {
      signInAs(role);

      expect((await run("no-existe")).status).toBe(403);
    });
  });
});

describe("F27 · Rutas digitales · el prestatario recibe 403 antes de leer el cuerpo", () => {
  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("%s: PUT con cuerpo no JSON → 403", async (role) => {
    signInAs(role);

    expect((await putContentRaw("libro-1", "esto no es json {")).status).toBe(403);
  });

  it("PUT con un cuerpo por encima del tope → 403 y no 400", async () => {
    signInAs("ESTUDIANTE");

    expect((await putContent("libro-1", "a".repeat(4_300_000))).status).toBe(403);
  });

  it("PATCH con un cuerpo inválido → 403 y no 400", async () => {
    signInAs("DOCENTE");

    expect((await patchCopies("libro-1", { digital_copies: -1 })).status).toBe(403);
    expect((await patchCopiesRaw("libro-1", "no es json")).status).toBe(403);
  });

  it("sin sesión, un cuerpo enorme responde 401", async () => {
    signOut();

    expect((await putContent("libro-1", "a".repeat(4_300_000))).status).toBe(401);
  });
});

describe("F27 · Rutas digitales · otro origen", () => {
  it.each(MUTATING)("$name: una petición de otro sitio responde 403", async ({ name }) => {
    signInAs("BIBLIOTECARIO");

    let response: Response;
    if (name.startsWith("PATCH")) {
      response = await patchCopies("libro-1", { digital_copies: 3 }, CROSS_SITE_JSON);
    } else {
      response = await putContent("libro-1", "# Texto", CROSS_SITE_JSON);
    }

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("Origen no permitido");
    const book = await routeHolder.world.books.find("libro-1");
    expect(book?.digital_copies).toBe(2);
    expect(book?.content).toBeNull();
  });

  it("el origen se comprueba antes que la sesión: otro origen sin sesión responde 403", async () => {
    signOut();

    expect((await putContent("libro-1", "# Texto", CROSS_SITE_JSON)).status).toBe(403);
    expect((await patchCopies("libro-1", { digital_copies: 3 }, CROSS_SITE_JSON)).status).toBe(403);
  });

  it("una cabecera `origin` de otro dominio también se rechaza", async () => {
    signInAs("BIBLIOTECARIO");
    const headers = { "content-type": "application/json", origin: "https://sitio-malo.example" };

    expect((await putContent("libro-1", "# Texto", headers)).status).toBe(403);
    expect((await patchCopies("libro-1", { digital_copies: 3 }, headers)).status).toBe(403);
  });

  it("el mismo origen declarado con `origin` se acepta", async () => {
    signInAs("BIBLIOTECARIO");
    const headers = { "content-type": "application/json", origin: "http://localhost" };

    expect((await putContent("libro-1", "# Texto", headers)).status).toBe(200);
    expect((await patchCopies("libro-1", { digital_copies: 3 }, headers)).status).toBe(200);
  });

  it("GET no exige comprobar el origen", async () => {
    signInAs("BIBLIOTECARIO");

    expect((await getInfo("libro-1")).status).toBe(200);
  });
});

describe("F27 · Rutas digitales · el :id", () => {
  beforeEach(() => {
    signInAs("BIBLIOTECARIO");
  });

  it.each(ROUTES)("$name: un libro inexistente responde 404 «El libro no existe.»", async ({ run }) => {
    const response = await run("no-existe");

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("El libro no existe.");
  });

  it.each(ROUTES)("$name: un :id con «/» responde 400", async ({ run }) => {
    expect((await run("a/b")).status).toBe(400);
  });

  it.each(ROUTES)("$name: un :id de 129 caracteres responde 400", async ({ run }) => {
    expect((await run("x".repeat(129))).status).toBe(400);
  });

  it.each(ROUTES)("$name: un :id de 128 caracteres es válido (404 si no existe)", async ({ run }) => {
    expect((await run("x".repeat(128))).status).toBe(404);
  });

  it.each(ROUTES)("$name: un :id de 128 caracteres de un libro existente responde 200", async ({ run }) => {
    const id = "y".repeat(128);
    routeHolder.world.books.addBook({ id, title: "Largo" });

    expect((await run(id)).status).toBe(200);
  });

  it.each(ROUTES)("$name: ids reservados («.», «..», «__x__») responden 400", async ({ run }) => {
    expect((await run(".")).status).toBe(400);
    expect((await run("..")).status).toBe(400);
    expect((await run("__x__")).status).toBe(400);
  });

  it("los errores de :id y de cuerpo se reportan con 400 antes que el 404", async () => {
    expect((await patchCopies("no-existe", { digital_copies: 500 })).status).toBe(400);
    expect((await putContent("no-existe", "")).status).toBe(400);
  });
});
