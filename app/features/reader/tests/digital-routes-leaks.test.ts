import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigitalService } from "@/features/reader/server/digital-service";
import { createDigitalService } from "@/features/reader/server/digital-service";
import { createMemoryDigitalBookRepository } from "@/features/reader/server/repository.memory";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { captureConsole } from "@/tests/helpers/digital";
import { routeHolder, resetRouteHolder, signInAs } from "@/tests/helpers/digital-route-state";
import { getInfo, patchCopies, putContent } from "@/tests/helpers/digital-route-calls";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

const SECRET = "FRASE-SECRETA-DEL-LIBRO-9f3a";
const TEXT = `# Título\n\n${SECRET}\n`;
let logged: () => string;

beforeEach(() => {
  resetRateLimits();
  resetRouteHolder();
  signInAs("BIBLIOTECARIO");
  logged = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function bodyOf(response: Response): Promise<string> {
  return response.text();
}

describe("F27 · Ninguna respuesta incluye el texto subido ni la ruta del archivo", () => {
  it("PUT con éxito, GET y PATCH posteriores", async () => {
    const put = await putContent("libro-1", TEXT);
    const path = routeHolder.world.store.paths()[0] ?? "no-hay-ruta";
    const putBody = await bodyOf(put);
    const getBody = await bodyOf(await getInfo("libro-1"));
    const patchBody = await bodyOf(await patchCopies("libro-1", { digital_copies: 5 }));

    for (const body of [putBody, getBody, patchBody]) {
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(path);
      expect(body).not.toContain("books/");
      expect(body).not.toContain("content-");
      expect(body).not.toContain(".md");
    }
  });

  it("las respuestas de error tampoco repiten el texto (contenido inválido con el secreto)", async () => {
    const response = await putContent("libro-1", `${SECRET}\u0000`);

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).not.toContain(SECRET);
  });

  it("el texto demasiado grande no se repite en el error 400", async () => {
    const response = await putContent("libro-1", SECRET + "a".repeat(2_000_001));

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).not.toContain(SECRET);
  });

  it("el 409 por subida simultánea no incluye texto ni ruta", async () => {
    const [first, second] = await Promise.all([putContent("libro-1", TEXT), putContent("libro-1", TEXT)]);

    const loser = [first, second].find((response) => response.status === 409);
    const body = await bodyOf(loser ?? first);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("books/");
  });

  it("el estado de un libro con contenido no revela la ruta guardada", async () => {
    routeHolder.world.books.addBook({
      id: "libro-2",
      title: "Con texto",
      content: { path: "books/libro-2/content-RUTA-INTERNA.md", bytes: 5, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    const body = await bodyOf(await getInfo("libro-2"));

    expect(body).not.toContain("RUTA-INTERNA");
    expect(body).not.toContain("books/");
  });
});

describe("F27 · Errores internos (500) y registro", () => {
  it("si falla el almacén: 500 «Error interno», nada cambia y el log no lleva el texto", async () => {
    routeHolder.world.store.failNext("put", new Error("el almacén no responde"));

    const response = await putContent("libro-1", TEXT);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Error interno" });
    expect(await routeHolder.world.books.find("libro-1")).toMatchObject({ content: null });
    expect(routeHolder.world.store.paths()).toEqual([]);
    expect(logged()).not.toContain(SECRET);
  });

  it("si falla la actualización del libro: 500 «Error interno», el archivo nuevo se borra y el log no lleva el texto", async () => {
    routeHolder.world.books.failNextReplace(new Error("la base no responde"));

    const response = await putContent("libro-1", TEXT);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Error interno" });
    expect(routeHolder.world.store.paths()).toEqual([]);
    const log = logged();
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain("books/");
  });

  it("si falla el borrado del anterior: 200 y el log no lleva texto ni rutas", async () => {
    await putContent("libro-1", "# Anterior");
    const oldPath = routeHolder.world.store.paths()[0] ?? "no-hay-ruta";
    routeHolder.world.store.failNext("remove", new Error("no se pudo borrar"));

    const response = await putContent("libro-1", TEXT);

    expect(response.status).toBe(200);
    const log = logged();
    expect(log).not.toBe("");
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain(oldPath);
    expect(await bodyOf(response)).not.toContain(oldPath);
  });

  it("un libro con el documento corrupto da 500 «Error interno» sin detalle", async () => {
    const broken: DigitalService = createDigitalService({
      books: {
        ...createMemoryDigitalBookRepository(),
        find: async () => {
          throw new Error("Documento corrupto: campo digital_copies=DETALLE-INTERNO");
        },
      },
      store: routeHolder.world.store,
      activeLoans: routeHolder.world.activeLoans,
    });
    routeHolder.service = broken;

    const info = await getInfo("libro-1");
    const copies = await patchCopies("libro-1", { digital_copies: 1 });
    const upload = await putContent("libro-1", TEXT);

    for (const response of [info, copies, upload]) {
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Error interno" });
    }
    expect(logged()).not.toContain(SECRET);
  });

  it("una subida correcta no escribe nada en el log", async () => {
    await putContent("libro-1", TEXT);

    expect(logged()).toBe("");
  });
});
