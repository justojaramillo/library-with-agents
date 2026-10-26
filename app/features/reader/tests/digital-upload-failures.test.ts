import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/shared/server/errors";
import { actorOf, byteLength, captureConsole, makeDigitalWorld, NOW, type DigitalWorld } from "@/tests/helpers/digital";

let world: DigitalWorld;
let logged: () => string;
const staff = actorOf("BIBLIOTECARIO");
const OLD_TEXT = "# Versión anterior SECRETO-VIEJO";
const NEW_TEXT = "# Versión nueva SECRETO-NUEVO";
const CONFLICT = "Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.";

beforeEach(() => {
  world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 2 });
  logged = captureConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedContent(): Promise<string> {
  await world.service.uploadContent(staff, "libro-1", { markdown: OLD_TEXT }, NOW);
  const stored = await world.books.find("libro-1");
  return stored?.content?.path ?? "";
}

describe("F27 · Subida · si falla la actualización del libro (compensación)", () => {
  it("con contenido previo: el archivo nuevo se borra y el libro conserva el contenido anterior", async () => {
    const oldPath = await seedContent();
    const before = await world.books.find("libro-1");
    const failure = new Error("fallo de la base");
    world.books.failNextReplace(failure);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(failure);

    expect(world.store.paths()).toEqual([oldPath]);
    expect(world.store.text(oldPath)).toBe(OLD_TEXT);
    expect((await world.books.find("libro-1"))?.content).toEqual(before?.content);
  });

  it("sin contenido previo: no queda ningún archivo y el libro sigue sin contenido", async () => {
    world.books.failNextReplace();

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toThrow();

    expect(world.store.paths()).toEqual([]);
    expect((await world.books.find("libro-1"))?.content).toBeNull();
  });

  it("si además falla el borrado del archivo nuevo, se propaga el error original y se registra sin texto", async () => {
    const original = new Error("fallo original de la base");
    world.books.failNextReplace(original);
    world.store.failNext("remove", new Error("no se pudo borrar"));

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(original);

    const log = logged();
    expect(log).not.toBe("");
    expect(log).not.toContain("SECRETO-NUEVO");
  });

  it("después de una compensación, la siguiente subida funciona", async () => {
    world.books.failNextReplace();
    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toThrow();

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    expect(info.has_content).toBe(true);
    expect(world.store.paths()).toHaveLength(1);
  });
});

describe("F27 · Subida · si falla el almacén", () => {
  it("si falla el `put` no cambia nada: el libro conserva su contenido y no hay archivos nuevos", async () => {
    const oldPath = await seedContent();
    const failure = new Error("blob caído");
    world.store.failNext("put", failure);

    await expect(world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW)).rejects.toBe(failure);

    expect(world.store.paths()).toEqual([oldPath]);
    expect((await world.books.find("libro-1"))?.content?.path).toBe(oldPath);
    expect(world.store.removed()).toEqual([]);
  });

  it("si falla el borrado del anterior, la subida responde bien y queda un aviso sin texto ni ruta", async () => {
    const oldPath = await seedContent();
    world.store.failNext("remove", new Error("no se pudo borrar"));

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    expect(info).toMatchObject({ has_content: true, content_bytes: byteLength(NEW_TEXT) });
    const newPath = (await world.books.find("libro-1"))?.content?.path;
    expect(newPath).not.toBe(oldPath);
    expect(world.store.paths()).toEqual([oldPath, newPath]);
    const log = logged();
    expect(log).not.toBe("");
    expect(log).not.toContain(oldPath);
    expect(log).not.toContain(newPath ?? "no-hay-ruta");
    expect(log).not.toContain("SECRETO-VIEJO");
    expect(log).not.toContain("SECRETO-NUEVO");
  });

  it("una subida normal no escribe nada en el log", async () => {
    await seedContent();
    await world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW);

    expect(logged()).toBe("");
  });
});

describe("F27 · Subida · dos subidas simultáneas", () => {
  it("sobre un libro sin contenido: una responde bien, la otra 409, y solo queda el archivo de la ganadora", async () => {
    const results = await Promise.allSettled([
      world.service.uploadContent(staff, "libro-1", { markdown: "# Primera" }, NOW),
      world.service.uploadContent(staff, "libro-1", { markdown: "# Segunda" }, NOW),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toEqual(new ConflictError(CONFLICT));
    const winnerPath = (await world.books.find("libro-1"))?.content?.path;
    expect(world.store.paths()).toEqual([winnerPath]);
  });

  it("sobre un libro con contenido: una gana, la otra 409, y el almacén queda con un solo archivo", async () => {
    await seedContent();

    const results = await Promise.allSettled([
      world.service.uploadContent(staff, "libro-1", { markdown: "# Primera" }, NOW),
      world.service.uploadContent(staff, "libro-1", { markdown: "# Segunda" }, NOW),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.reason).toBeInstanceOf(ConflictError);
    const winnerPath = (await world.books.find("libro-1"))?.content?.path;
    expect(world.store.paths()).toEqual([winnerPath]);
  });

  it("el texto que queda guardado es el de la subida que ganó", async () => {
    const results = await Promise.allSettled([
      world.service.uploadContent(staff, "libro-1", { markdown: "# Primera" }, NOW),
      world.service.uploadContent(staff, "libro-1", { markdown: "# Segunda larga" }, NOW),
    ]);

    const winner = results.find((result) => result.status === "fulfilled");
    const winnerBytes = winner?.status === "fulfilled" && winner.value.content_bytes;
    const stored = await world.books.find("libro-1");
    expect(stored?.content?.bytes).toBe(winnerBytes);
  });

  it("subir contenido y fijar copias a la vez son independientes: ambos funcionan", async () => {
    const [upload, copies] = await Promise.all([
      world.service.uploadContent(staff, "libro-1", { markdown: NEW_TEXT }, NOW),
      world.service.setCopies(staff, "libro-1", { digital_copies: 9 }),
    ]);

    expect(upload.has_content).toBe(true);
    expect(copies.digital_copies).toBe(9);
    const stored = await world.books.find("libro-1");
    expect(stored?.digital_copies).toBe(9);
    expect(stored?.content).not.toBeNull();
  });
});
