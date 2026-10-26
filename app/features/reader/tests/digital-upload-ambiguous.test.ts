import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDigitalService } from "@/features/reader/server/digital-service";
import type { DigitalBookRepository } from "@/features/reader/server/repository";
import { ConflictError, NotFoundError } from "@/shared/server/errors";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { actorOf, byteLength, captureConsole, makeDigitalWorld, NOW, type DigitalWorld } from "@/tests/helpers/digital";
import { putContent } from "@/tests/helpers/digital-route-calls";
import { resetRouteHolder, routeHolder, signInAs } from "@/tests/helpers/digital-route-state";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

const staff = actorOf("BIBLIOTECARIO");
const OLD_TEXT = "# Versión anterior SECRETO-VIEJO";
const NEW_TEXT = "# Versión nueva SECRETO-NUEVO";

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

function freshWorld(): DigitalWorld {
  const world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 2 });
  return world;
}

async function pathOf(world: DigitalWorld): Promise<string> {
  const stored = await world.books.find("libro-1");
  return stored?.content?.path ?? "no-hay-ruta";
}

/**
 * Repositorio que activa `failNextFind` justo antes de `replaceContent`: así el primer `find` del servicio (previo a
 * subir) funciona y el segundo (la relectura tras un fallo ambiguo) falla. `replaceContent` falla con `original`.
 */
function booksWhoseRereadFails(world: DigitalWorld, original: Error): DigitalBookRepository {
  return {
    ...world.books,
    async replaceContent(bookId, expectedPath, next) {
      world.books.failNextFind(new Error("la relectura falló"));
      world.books.failNextReplace(original);
      return world.books.replaceContent(bookId, expectedPath, next);
    },
  };
}

function warnings(): string {
  return vi
    .mocked(console.warn)
    .mock.calls.map((call) => call.map((arg) => String(arg)).join(" "))
    .join("\n");
}

describe("F27 · Subida · fallo ambiguo: replaceContent falla pero el libro ya apunta al archivo nuevo", () => {
  it("con contenido previo: responde bien, conserva el archivo nuevo y deja huérfano el anterior", async () => {
    const world = freshWorld();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const oldPath = await pathOf(world);
    world.books.failNextReplaceAfterCommit();

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    const newPath = await pathOf(world);
    expect(newPath).not.toBe(oldPath);
    expect(info).toEqual({
      book_id: "libro-1",
      title: "Rayuela",
      digital_copies: 2,
      has_content: true,
      content_bytes: byteLength(NEW_TEXT),
      content_updated_at: NOW.toISOString(),
    });
    expect(world.store.paths()).toEqual([oldPath, newPath]);
    expect(world.store.text(newPath)).toBe(NEW_TEXT);
    expect(world.store.removed()).toEqual([]);
  });

  it("registra un aviso (warn) sin texto ni ruta", async () => {
    const world = freshWorld();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const oldPath = await pathOf(world);
    world.books.failNextReplaceAfterCommit();

    await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    const newPath = await pathOf(world);
    expect(console.warn).toHaveBeenCalledTimes(1);
    for (const text of [warnings(), logged()]) {
      expect(text).not.toBe("");
      expect(text).not.toContain(oldPath);
      expect(text).not.toContain(newPath);
      expect(text).not.toContain("books/");
      expect(text).not.toContain("SECRETO-VIEJO");
      expect(text).not.toContain("SECRETO-NUEVO");
    }
  });

  it("sin contenido previo: responde bien y el archivo nuevo sigue en el almacén y en uso", async () => {
    const world = freshWorld();
    world.books.failNextReplaceAfterCommit();

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    const newPath = await pathOf(world);
    expect(info).toMatchObject({ has_content: true, content_bytes: byteLength(NEW_TEXT) });
    expect(world.store.paths()).toEqual([newPath]);
    expect(world.store.removed()).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(newPath);
    expect(logged()).not.toContain("SECRETO-NUEVO");
  });

  it("la siguiente subida funciona y reemplaza el archivo que quedó en uso", async () => {
    const world = freshWorld();
    world.books.failNextReplaceAfterCommit();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const confirmedPath = await pathOf(world);

    await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    expect(world.store.paths()).toEqual([await pathOf(world)]);
    expect(world.store.paths()).not.toContain(confirmedPath);
  });
});

describe("F27 · Subida · fallo que NO se confirmó: el libro sigue con la ruta anterior", () => {
  it("con contenido previo: se borra el archivo nuevo, se propaga el error original y se conserva el anterior", async () => {
    const world = freshWorld();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const oldPath = await pathOf(world);
    const original = new Error("fallo de la base antes de confirmar");
    world.books.failNextReplace(original);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(original);

    expect(world.store.paths()).toEqual([oldPath]);
    expect(world.store.text(oldPath)).toBe(OLD_TEXT);
    expect(await pathOf(world)).toBe(oldPath);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("sin contenido previo: no queda ningún archivo y el libro sigue sin contenido", async () => {
    const world = freshWorld();
    const original = new Error("fallo de la base antes de confirmar");
    world.books.failNextReplace(original);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(original);

    expect(world.store.paths()).toEqual([]);
    expect((await world.books.find("libro-1"))?.content).toBeNull();
  });
});

describe("F27 · Subida · fallo ambiguo cuando la relectura también falla", () => {
  it("se trata como «no apunta»: se borra el archivo nuevo y se propaga el error original", async () => {
    const world = freshWorld();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const oldPath = await pathOf(world);
    const original = new Error("fallo original de la base");
    const service = createDigitalService({
      books: booksWhoseRereadFails(world, original),
      store: world.store,
      activeLoans: world.activeLoans,
    });

    await expect(service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(original);

    expect(world.store.paths()).toEqual([oldPath]);
    expect(await pathOf(world)).toBe(oldPath);
  });

  it("sin contenido previo: no queda ningún archivo y el log no lleva texto ni ruta", async () => {
    const world = freshWorld();
    const original = new Error("fallo original de la base");
    const service = createDigitalService({
      books: booksWhoseRereadFails(world, original),
      store: world.store,
      activeLoans: world.activeLoans,
    });

    await expect(service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(original);

    expect(world.store.paths()).toEqual([]);
    const log = logged();
    expect(log).not.toBe("");
    expect(log).not.toContain("SECRETO-NUEVO");
    expect(log).not.toContain("books/libro-1/content-");
  });
});

describe("F27 · Subida · ConflictError y NotFoundError siguen borrando el archivo nuevo", () => {
  it("ConflictError: se borra el archivo nuevo y se propaga el mismo error", async () => {
    const world = freshWorld();
    await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
    const oldPath = await pathOf(world);
    const conflict = new ConflictError("Otro cambio se adelantó.");
    world.books.failNextReplace(conflict);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(conflict);

    expect(world.store.paths()).toEqual([oldPath]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("NotFoundError: se borra el archivo nuevo y se propaga el mismo error", async () => {
    const world = freshWorld();
    const missing = new NotFoundError("El libro no existe.");
    world.books.failNextReplace(missing);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(missing);

    expect(world.store.paths()).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("una subida simultánea que pierde sigue dando 409 y no deja archivo huérfano", async () => {
    const world = freshWorld();

    const results = await Promise.allSettled([
      world.service.uploadContent(staff, "libro-1", { markdown: "# Primera" }, NOW),
      world.service.uploadContent(staff, "libro-1", { markdown: "# Segunda" }, NOW),
    ]);

    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(world.store.paths()).toEqual([await pathOf(world)]);
  });
});

describe("F27 · Subida · fallo ambiguo por HTTP", () => {
  it("fallo posterior a confirmar: 200 con el estado, sin texto ni ruta en la respuesta ni en el log", async () => {
    routeHolder.world.books.failNextReplaceAfterCommit();

    const response = await putContent("libro-1", NEW_TEXT);

    expect(response.status).toBe(200);
    const body = await response.text();
    const newPath = await pathOf(routeHolder.world);
    expect(JSON.parse(body)).toMatchObject({
      book_id: "libro-1",
      has_content: true,
      content_bytes: byteLength(NEW_TEXT),
    });
    expect(routeHolder.world.store.paths()).toEqual([newPath]);
    for (const text of [body, logged()]) {
      expect(text).not.toContain(newPath);
      expect(text).not.toContain("books/");
      expect(text).not.toContain("SECRETO-NUEVO");
    }
  });

  it("fallo que no se confirmó: 500 «Error interno», se borra el archivo nuevo y se conserva el anterior", async () => {
    await putContent("libro-1", OLD_TEXT);
    const oldPath = await pathOf(routeHolder.world);
    routeHolder.world.books.failNextReplace(new Error("la base no responde DETALLE-INTERNO"));

    const response = await putContent("libro-1", NEW_TEXT);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Error interno" });
    expect(routeHolder.world.store.paths()).toEqual([oldPath]);
    expect(routeHolder.world.store.text(oldPath)).toBe(OLD_TEXT);
    expect(logged()).not.toContain("SECRETO-NUEVO");
  });

  it("relectura fallida: 500 «Error interno» y no queda el archivo nuevo", async () => {
    const original = new Error("fallo original de la base");
    routeHolder.service = createDigitalService({
      books: booksWhoseRereadFails(routeHolder.world, original),
      store: routeHolder.world.store,
      activeLoans: routeHolder.world.activeLoans,
    });

    const response = await putContent("libro-1", NEW_TEXT);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Error interno" });
    expect(routeHolder.world.store.paths()).toEqual([]);
    expect(logged()).not.toContain("SECRETO-NUEVO");
  });
});
