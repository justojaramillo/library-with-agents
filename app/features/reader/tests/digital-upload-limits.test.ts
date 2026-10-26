import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { actorOf, asciiOfBytes, makeDigitalWorld, NOW, type DigitalWorld } from "@/tests/helpers/digital";
import { DIGITAL_RULES } from "../schema";

let world: DigitalWorld;
const staff = actorOf("BIBLIOTECARIO");
const LIMIT = 2_000_000;

beforeEach(() => {
  world = makeDigitalWorld();
  world.books.addBook({ id: "libro-1", title: "Rayuela" });
});

async function upload(markdown: string) {
  return world.service.uploadContent(staff, "libro-1", { markdown }, NOW);
}

async function expectRejected(markdown: string): Promise<void> {
  await expect(upload(markdown)).rejects.toBeInstanceOf(ZodError);
  expect(world.store.paths()).toEqual([]);
  expect((await world.books.find("libro-1"))?.content).toBeNull();
}

describe("F27 · Contenido · tamaño en bytes UTF-8", () => {
  it("el máximo del contrato es 2 000 000 de bytes", () => {
    expect(DIGITAL_RULES.maxMarkdownBytes).toBe(LIMIT);
  });

  it.each([1, 1_999_999, 2_000_000])("%i bytes ASCII se aceptan y content_bytes coincide", async (bytes) => {
    const info = await upload(asciiOfBytes(bytes));

    expect(info.content_bytes).toBe(bytes);
  });

  it("2 000 001 bytes se rechazan y no se guarda nada", async () => {
    await expectRejected(asciiOfBytes(LIMIT + 1));
  });

  it("las tildes cuentan 2 bytes: 1 000 000 de «á» caben justo y uno más no", async () => {
    const info = await upload("á".repeat(1_000_000));
    expect(info.content_bytes).toBe(LIMIT);

    const other = makeDigitalWorld();
    other.books.addBook({ id: "libro-1", title: "Rayuela" });
    await expect(
      other.service.uploadContent(staff, "libro-1", { markdown: "á".repeat(1_000_001) }, NOW),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("2 000 000 de caracteres de dos bytes (4 MB) se rechazan aunque sean «solo» 2 millones de caracteres", async () => {
    await expectRejected("é".repeat(LIMIT));
  });

  it("los emojis cuentan 4 bytes: 500 000 caben exactos (2 000 000 de bytes)", async () => {
    const info = await upload("😀".repeat(500_000));

    expect(info.content_bytes).toBe(LIMIT);
  });

  it("500 000 emojis y una letra (2 000 001 bytes) se rechazan", async () => {
    await expectRejected("😀".repeat(500_000) + "a");
  });

  it("499 999 emojis y 4 letras suman justo 2 000 000 de bytes y se aceptan", async () => {
    const info = await upload("😀".repeat(499_999) + "abcd");

    expect(info.content_bytes).toBe(LIMIT);
  });

  it("un texto con tildes, emojis y saltos de línea cuenta bytes, no caracteres", async () => {
    const text = "Canción 🎵\nñandú\n";

    const info = await upload(text);

    expect(info.content_bytes).toBe(new TextEncoder().encode(text).length);
    expect(info.content_bytes).toBeGreaterThan(text.length);
  });

  it("los saltos de línea \\r\\n se cuentan como dos bytes y se guardan sin cambiar", async () => {
    const text = "línea uno\r\nlínea dos\r\n";

    const info = await upload(text);

    expect(info.content_bytes).toBe(new TextEncoder().encode(text).length);
    expect(world.store.text(world.store.paths()[0] ?? "")).toBe(text);
  });

  it("999 999 pares «\\r\\n» más una letra (1 999 999 bytes) se aceptan", async () => {
    const text = "\r\n".repeat(999_999) + "a";

    const info = await upload(text);

    expect(info.content_bytes).toBe(2 * 999_999 + 1);
  });
});

describe("F27 · Contenido · vacío y carácter nulo", () => {
  it.each([
    ["vacío", ""],
    ["un espacio", " "],
    ["solo espacios", "     "],
    ["saltos de línea", "\n\n\n"],
    ["tabuladores y saltos", "\t\r\n \t"],
  ])("%s se rechaza", async (_name, text) => {
    await expectRejected(text);
  });

  it("un solo carácter visible rodeado de espacios es válido", async () => {
    const info = await upload("   a   ");

    expect(info.content_bytes).toBe(7);
  });

  it.each([
    ["solo el carácter nulo", "\u0000"],
    ["al principio", "\u0000# Título"],
    ["en medio", "uno\u0000dos"],
    ["al final", "texto\u0000"],
  ])("el carácter nulo %s se rechaza", async (_name, text) => {
    await expectRejected(text);
  });

  it("el campo `markdown` ausente se rechaza", async () => {
    await expect(world.service.uploadContent(staff, "libro-1", {}, NOW)).rejects.toBeInstanceOf(ZodError);
    expect(world.store.paths()).toEqual([]);
  });

  it("un texto rechazado no borra el contenido que ya había", async () => {
    await upload("# Original");
    const before = (await world.books.find("libro-1"))?.content;

    await expect(upload("")).rejects.toBeInstanceOf(ZodError);
    await expect(upload("con\u0000nulo")).rejects.toBeInstanceOf(ZodError);

    expect((await world.books.find("libro-1"))?.content).toEqual(before);
    expect(world.store.paths()).toHaveLength(1);
  });
});
