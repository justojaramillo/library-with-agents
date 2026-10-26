import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import type { Role } from "@/shared/schema";
import { actorOf, makeDigitalWorld, type DigitalWorld } from "@/tests/helpers/digital";
import { DigitalInfoSchema } from "../schema";

let world: DigitalWorld;

beforeEach(() => {
  world = makeDigitalWorld();
});

describe("F27 · Estado digital de un libro · caso feliz", () => {
  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"] satisfies Role[])("%s consulta un libro sin contenido", async (role) => {
    world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 3 });

    const info = await world.service.info(actorOf(role), "libro-1");

    expect(DigitalInfoSchema.parse(info)).toEqual({
      book_id: "libro-1",
      title: "Rayuela",
      digital_copies: 3,
      has_content: false,
      content_bytes: null,
      content_updated_at: null,
    });
  });

  it("un libro con contenido informa tamaño y fecha, pero no la ruta ni el texto", async () => {
    world.books.addBook({
      id: "libro-1",
      title: "Rayuela",
      digital_copies: 2,
      content: { path: "books/libro-1/content-secreto-abc.md", bytes: 1024, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    const info = await world.service.info(actorOf("BIBLIOTECARIO"), "libro-1");

    expect(info).toEqual({
      book_id: "libro-1",
      title: "Rayuela",
      digital_copies: 2,
      has_content: true,
      content_bytes: 1024,
      content_updated_at: "2026-03-01T08:00:00.000Z",
    });
    expect(JSON.stringify(info)).not.toContain("secreto-abc");
    expect(Object.keys(info).sort()).toEqual(
      ["book_id", "content_bytes", "content_updated_at", "digital_copies", "has_content", "title"].sort(),
    );
  });

  it("un libro existente sin campos digitales tiene 0 copias digitales y ningún contenido", async () => {
    world.books.addBook({ id: "libro-viejo", title: "Ficciones" });

    const info = await world.service.info(actorOf("ADMINISTRADOR"), "libro-viejo");

    expect(info).toMatchObject({
      digital_copies: 0,
      has_content: false,
      content_bytes: null,
      content_updated_at: null,
    });
  });

  it("un contenido de 0 bytes registrado sigue contando como cargado", async () => {
    world.books.addBook({
      id: "libro-1",
      title: "Vacío",
      content: { path: "books/libro-1/c.md", bytes: 0, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    expect(await world.service.info(actorOf("BIBLIOTECARIO"), "libro-1")).toMatchObject({
      has_content: true,
      content_bytes: 0,
    });
  });
});

describe("F27 · Estado digital · errores y autorización", () => {
  it("un libro que no existe responde «El libro no existe.»", async () => {
    await expect(world.service.info(actorOf("BIBLIOTECARIO"), "no-existe")).rejects.toThrow(
      new NotFoundError("El libro no existe."),
    );
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("%s no puede consultar", async (role) => {
    world.books.addBook({ id: "libro-1", title: "Rayuela" });

    await expect(world.service.info(actorOf(role), "libro-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un prestatario recibe «prohibido» aunque el id sea inválido o el libro no exista", async () => {
    await expect(world.service.info(actorOf("ESTUDIANTE"), "a/b")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(world.service.info(actorOf("ESTUDIANTE"), "no-existe")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("F27 · Estado digital · bordes del id", () => {
  it.each(["a/b", "", ".", "..", "__x__", "x".repeat(129)])("el id %j se rechaza como dato inválido", async (id) => {
    await expect(world.service.info(actorOf("BIBLIOTECARIO"), id)).rejects.toBeInstanceOf(ZodError);
  });

  it("un id de 128 caracteres es válido: libro inexistente → 404, existente → estado", async () => {
    const id = "x".repeat(128);
    await expect(world.service.info(actorOf("BIBLIOTECARIO"), id)).rejects.toBeInstanceOf(NotFoundError);

    world.books.addBook({ id, title: "Largo" });
    expect((await world.service.info(actorOf("BIBLIOTECARIO"), id)).book_id).toBe(id);
  });

  it("consultar no cambia nada ni escribe en el almacén", async () => {
    world.books.addBook({ id: "libro-1", title: "Rayuela" });

    await world.service.info(actorOf("BIBLIOTECARIO"), "libro-1");

    expect(world.store.paths()).toEqual([]);
    expect(world.store.removed()).toEqual([]);
  });
});
