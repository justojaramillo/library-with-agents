import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/server/errors";
import type { Role } from "@/shared/schema";
import { actorOf, makeDigitalWorld, type DigitalWorld } from "@/tests/helpers/digital";
import { DIGITAL_RULES, SetDigitalCopiesInputSchema } from "../schema";

let world: DigitalWorld;
const staff = actorOf("BIBLIOTECARIO");

beforeEach(() => {
  world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela", digital_copies: 4 });
});

async function copiesOf(id: string): Promise<number | undefined> {
  return (await world.books.find(id))?.digital_copies;
}

describe("F27 · Copias digitales · caso feliz y bordes del número", () => {
  it.each([0, 1, 2, 99, 100])("fijar %i copias digitales funciona y devuelve el estado actualizado", async (n) => {
    const info = await world.service.setCopies(staff, "libro-1", { digital_copies: n });

    expect(info).toMatchObject({ book_id: "libro-1", title: "Rayuela", digital_copies: n });
    expect(await copiesOf("libro-1")).toBe(n);
  });

  it("el máximo del contrato es 100", () => {
    expect(DIGITAL_RULES.maxCopies).toBe(100);
  });

  it.each([
    -1,
    101,
    1.5,
    1000,
    Number.NaN,
  ])("fijar %s copias digitales es un dato inválido y nada cambia", async (n) => {
    await expect(world.service.setCopies(staff, "libro-1", { digital_copies: n })).rejects.toBeInstanceOf(ZodError);

    expect(await copiesOf("libro-1")).toBe(4);
  });

  it("sin el campo `digital_copies` es un dato inválido", async () => {
    await expect(world.service.setCopies(staff, "libro-1", {})).rejects.toBeInstanceOf(ZodError);

    expect(await copiesOf("libro-1")).toBe(4);
  });

  it("el esquema del contrato rechaza texto, null y ausente", () => {
    expect(SetDigitalCopiesInputSchema.safeParse({ digital_copies: "3" }).success).toBe(false);
    expect(SetDigitalCopiesInputSchema.safeParse({ digital_copies: null }).success).toBe(false);
    expect(SetDigitalCopiesInputSchema.safeParse({}).success).toBe(false);
    expect(SetDigitalCopiesInputSchema.safeParse({ digital_copies: 100 }).success).toBe(true);
  });

  it("fijar el mismo valor que ya tiene es idempotente (200)", async () => {
    const first = await world.service.setCopies(staff, "libro-1", { digital_copies: 4 });
    const second = await world.service.setCopies(staff, "libro-1", { digital_copies: 4 });

    expect(second).toEqual(first);
    expect(second.digital_copies).toBe(4);
  });

  it("un libro sin campos digitales puede recibir copias (parte de 0)", async () => {
    world.books.addBook({ id: "libro-viejo", title: "Ficciones" });

    const info = await world.service.setCopies(staff, "libro-viejo", { digital_copies: 5 });

    expect(info.digital_copies).toBe(5);
  });
});

describe("F27 · Copias digitales · independencia del contenido", () => {
  it("se pueden fijar copias sin contenido cargado", async () => {
    const info = await world.service.setCopies(staff, "libro-1", { digital_copies: 7 });

    expect(info).toMatchObject({ digital_copies: 7, has_content: false });
  });

  it("poner 0 copias no borra el contenido ni toca el almacén", async () => {
    world.books.addBook({
      id: "libro-2",
      title: "Con texto",
      digital_copies: 3,
      content: { path: "books/libro-2/c.md", bytes: 10, updatedAt: "2026-03-01T08:00:00.000Z" },
    });

    const info = await world.service.setCopies(staff, "libro-2", { digital_copies: 0 });

    expect(info).toMatchObject({ digital_copies: 0, has_content: true, content_bytes: 10 });
    expect(world.store.removed()).toEqual([]);
  });
});

describe("F27 · Copias digitales · no bajar de los préstamos activos", () => {
  it("con 3 préstamos activos, dejar 2 copias responde 409 con el texto de la regla y nada cambia", async () => {
    world.activeLoans.setActive("libro-1", 3);

    await expect(world.service.setCopies(staff, "libro-1", { digital_copies: 2 })).rejects.toThrow(
      new ConflictError("No puedes dejar menos copias digitales que préstamos digitales activos (3)."),
    );
    expect(await copiesOf("libro-1")).toBe(4);
  });

  it("dejar exactamente 3 copias con 3 activos es válido (límite)", async () => {
    world.activeLoans.setActive("libro-1", 3);

    const info = await world.service.setCopies(staff, "libro-1", { digital_copies: 3 });

    expect(info.digital_copies).toBe(3);
  });

  it("dejar 4 copias con 3 activos es válido (límite + 1)", async () => {
    world.activeLoans.setActive("libro-1", 3);

    expect((await world.service.setCopies(staff, "libro-1", { digital_copies: 4 })).digital_copies).toBe(4);
  });

  it("con 1 préstamo activo, poner 0 copias responde 409", async () => {
    world.activeLoans.setActive("libro-1", 1);

    await expect(world.service.setCopies(staff, "libro-1", { digital_copies: 0 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("sin préstamos activos se puede poner 0", async () => {
    expect((await world.service.setCopies(staff, "libro-1", { digital_copies: 0 })).digital_copies).toBe(0);
  });

  it("los préstamos activos de otro libro no estorban", async () => {
    world.activeLoans.setActive("otro-libro", 50);

    expect((await world.service.setCopies(staff, "libro-1", { digital_copies: 0 })).digital_copies).toBe(0);
  });
});

describe("F27 · Copias digitales · errores y orden de comprobaciones", () => {
  it("un libro inexistente responde 404", async () => {
    await expect(world.service.setCopies(staff, "no-existe", { digital_copies: 1 })).rejects.toThrow(
      new NotFoundError("El libro no existe."),
    );
  });

  it("un cuerpo inválido sobre un libro inexistente responde 400 (la validación va antes del 404)", async () => {
    await expect(world.service.setCopies(staff, "no-existe", { digital_copies: -1 })).rejects.toBeInstanceOf(ZodError);
  });

  it("un id mal formado responde 400", async () => {
    await expect(world.service.setCopies(staff, "a/b", { digital_copies: 1 })).rejects.toBeInstanceOf(ZodError);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[])("%s no puede fijar copias", async (role) => {
    await expect(world.service.setCopies(actorOf(role), "libro-1", { digital_copies: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await copiesOf("libro-1")).toBe(4);
  });

  it("un prestatario recibe «prohibido» aunque el cuerpo o el id sean inválidos", async () => {
    const borrower = actorOf("ESTUDIANTE");

    await expect(world.service.setCopies(borrower, "a/b", { digital_copies: -5 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(world.service.setCopies(borrower, "no-existe", {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el administrador también puede fijar copias", async () => {
    const info = await world.service.setCopies(actorOf("ADMINISTRADOR"), "libro-1", { digital_copies: 9 });

    expect(info.digital_copies).toBe(9);
  });
});
