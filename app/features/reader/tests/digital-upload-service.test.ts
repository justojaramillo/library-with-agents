import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import type { Role } from "@/shared/schema";
import { actorOf, byteLength, makeDigitalWorld, NOW, type DigitalWorld } from "@/tests/helpers/digital";
import { DigitalInfoSchema } from "../schema";

let world: DigitalWorld;
const staff = actorOf("BIBLIOTECARIO");
const TEXT = "# Rayuela\n\nPrimer capítulo.\n";

beforeEach(() => {
  world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 2 });
});

async function pathOf(id: string): Promise<string | undefined> {
  return (await world.books.find(id))?.content?.path;
}

describe("F27 · Subir contenido · primera carga", () => {
  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ] satisfies Role[])("%s sube el texto de un libro sin contenido", async (role) => {
    const text = "x".repeat(1024);

    const info = await world.service.uploadContent(actorOf(role), "libro-1", { markdown: text }, NOW);

    expect(DigitalInfoSchema.parse(info)).toEqual({
      book_id: "libro-1",
      title: "Rayuela",
      digital_copies: 2,
      has_content: true,
      content_bytes: 1024,
      content_updated_at: NOW.toISOString(),
    });
  });

  it("el archivo queda en el almacén bajo books/{id}/ con el texto tal cual", async () => {
    await world.service.uploadContent(staff, "libro-1", { markdown: TEXT }, NOW);

    const paths = world.store.paths();
    expect(paths).toHaveLength(1);
    expect(paths[0]?.startsWith("books/libro-1/")).toBe(true);
    expect(world.store.text(paths[0] ?? "")).toBe(TEXT);
  });

  it("el libro guarda la ruta del archivo nuevo, el tamaño y el instante inyectado", async () => {
    await world.service.uploadContent(staff, "libro-1", { markdown: TEXT }, NOW);

    const stored = await world.books.find("libro-1");
    expect(stored?.content).toEqual({
      path: world.store.paths()[0],
      bytes: new TextEncoder().encode(TEXT).length,
      updatedAt: "2026-03-05T12:30:00.000Z",
    });
  });

  it("la respuesta no incluye ni la ruta del archivo ni el texto", async () => {
    const info = await world.service.uploadContent(staff, "libro-1", { markdown: TEXT }, NOW);

    const json = JSON.stringify(info);
    expect(json).not.toContain(world.store.paths()[0] ?? "no-hay-ruta");
    expect(json).not.toContain("books/");
    expect(json).not.toContain("Primer capítulo");
  });

  it("el HTML y los scripts se guardan tal cual (el saneado ocurre al mostrar)", async () => {
    const html = "<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n# Título";

    await world.service.uploadContent(staff, "libro-1", { markdown: html }, NOW);

    expect(world.store.text(world.store.paths()[0] ?? "")).toBe(html);
  });

  it("el espacio alrededor del texto no se recorta al guardar, y cuenta en los bytes", async () => {
    const padded = "  \n# Título\n\n  ";

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: padded }, NOW);

    expect(world.store.text(world.store.paths()[0] ?? "")).toBe(padded);
    expect(info.content_bytes).toBe(byteLength(padded));
  });

  it("subir contenido no cambia las copias digitales", async () => {
    const info = await world.service.uploadContent(staff, "libro-1", { markdown: TEXT }, NOW);

    expect(info.digital_copies).toBe(2);
  });

  it("la consulta posterior refleja el contenido cargado", async () => {
    await world.service.uploadContent(staff, "libro-1", { markdown: TEXT }, NOW);

    expect(await world.service.info(staff, "libro-1")).toMatchObject({
      has_content: true,
      content_updated_at: NOW.toISOString(),
    });
  });

  it("un contenido de 1 byte es válido (borde inferior)", async () => {
    const info = await world.service.uploadContent(staff, "libro-1", { markdown: "a" }, NOW);

    expect(info.content_bytes).toBe(1);
  });
});

describe("F27 · Subir contenido · reemplazo", () => {
  const FIRST = "# Versión uno";
  const SECOND = "# Versión dos, más larga";

  it("el libro apunta al archivo nuevo, el anterior se borra y queda un solo archivo", async () => {
    await world.service.uploadContent(staff, "libro-1", { markdown: FIRST }, NOW);
    const oldPath = await pathOf("libro-1");

    const later = new Date("2026-03-06T09:00:00.000Z");
    const info = await world.service.uploadContent(staff, "libro-1", { markdown: SECOND }, later);

    const newPath = await pathOf("libro-1");
    expect(newPath).not.toBe(oldPath);
    expect(world.store.paths()).toEqual([newPath]);
    expect(world.store.removed()).toEqual([oldPath]);
    expect(world.store.text(newPath ?? "")).toBe(SECOND);
    expect(info).toMatchObject({
      has_content: true,
      content_bytes: byteLength(SECOND),
      content_updated_at: "2026-03-06T09:00:00.000Z",
    });
  });

  it("reemplazar con un libro que ya traía contenido (sembrado) también deja un solo archivo", async () => {
    const seeded = await world.store.put("libro-2", FIRST);
    world.books.addBook({
      id: "libro-2",
      title: "Sembrado",
      content: { path: seeded.path, bytes: FIRST.length, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    await world.service.uploadContent(staff, "libro-2", { markdown: SECOND }, NOW);

    expect(world.store.paths()).toHaveLength(1);
    expect(world.store.paths()).not.toContain(seeded.path);
  });

  it("subir lo mismo dos veces es válido y deja un solo archivo", async () => {
    await world.service.uploadContent(staff, "libro-1", { markdown: FIRST }, NOW);
    await world.service.uploadContent(staff, "libro-1", { markdown: FIRST }, NOW);

    expect(world.store.paths()).toHaveLength(1);
  });

  it("los archivos de otro libro no se tocan", async () => {
    world.books.addBook({ id: "libro-2", title: "Otro" });
    await world.service.uploadContent(staff, "libro-2", { markdown: "otro texto" }, NOW);
    const otherPath = await pathOf("libro-2");

    await world.service.uploadContent(staff, "libro-1", { markdown: FIRST }, NOW);
    await world.service.uploadContent(staff, "libro-1", { markdown: SECOND }, NOW);

    expect(world.store.paths()).toContain(otherPath);
    expect(world.store.paths()).toHaveLength(2);
  });

  it("reemplazar el contenido no cambia las copias digitales ni los préstamos activos", async () => {
    world.activeLoans.setActive("libro-1", 2);
    await world.service.uploadContent(staff, "libro-1", { markdown: FIRST }, NOW);

    const info = await world.service.uploadContent(staff, "libro-1", { markdown: SECOND }, NOW);

    expect(info.digital_copies).toBe(2);
  });
});

describe("F27 · Subir contenido · errores y orden de comprobaciones", () => {
  it("un libro inexistente responde 404 y no deja archivos", async () => {
    await expect(world.service.uploadContent(staff, "no-existe", { markdown: TEXT }, NOW)).rejects.toThrow(
      new NotFoundError("El libro no existe."),
    );
    expect(world.store.paths()).toEqual([]);
  });

  it("un cuerpo inválido sobre un libro inexistente responde 400 (la validación va antes del 404)", async () => {
    await expect(world.service.uploadContent(staff, "no-existe", {}, NOW)).rejects.toBeInstanceOf(ZodError);
  });

  it.each(["a/b", "", ".", "__x__", "x".repeat(129)])("el id %j responde 400 y no sube nada", async (id) => {
    await expect(world.service.uploadContent(staff, id, { markdown: TEXT }, NOW)).rejects.toBeInstanceOf(ZodError);
    expect(world.store.paths()).toEqual([]);
  });

  it("un id de 128 caracteres es válido", async () => {
    const id = "x".repeat(128);
    world.books.addBook({ id, title: "Largo" });

    const info = await world.service.uploadContent(staff, id, { markdown: TEXT }, NOW);

    expect(info.book_id).toBe(id);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("%s no puede subir contenido", async (role) => {
    await expect(world.service.uploadContent(actorOf(role), "libro-1", { markdown: TEXT }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(world.store.paths()).toEqual([]);
  });

  it("un prestatario recibe «prohibido» aunque el id o el cuerpo sean inválidos", async () => {
    const borrower = actorOf("DOCENTE");

    await expect(world.service.uploadContent(borrower, "a/b", {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(world.service.uploadContent(borrower, "no-existe", { markdown: "" }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
