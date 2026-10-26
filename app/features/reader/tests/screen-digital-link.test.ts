import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/page";
import { RegisterBookLink } from "@/register-book-link";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { attributeOf, linkTexts, openingTags, textOf } from "@/tests/helpers/html";
import { textOwners } from "@/tests/helpers/html-text";
import { renderComplete } from "@/tests/helpers/render-page";

const holder = vi.hoisted(() => ({
  world: null as World | null,
  user: null as { member_id: string; role: string } | null,
  failRead: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/shared/server/http", () => ({
  getSessionUser: async () => {
    if (holder.failRead) {
      throw new Error("falló la lectura de la sesión");
    }
    return holder.user;
  },
}));
vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { books: holder.world.books };
  },
}));

const NOW = new Date("2026-03-01T10:00:00.000Z");
const BORROWERS = ["EXTERNO", "ESTUDIANTE", "DOCENTE"];
const STAFF = ["BIBLIOTECARIO", "ADMINISTRADOR"];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetRateLimits();
  holder.world = makeWorld();
  holder.user = null;
  holder.failRead = false;
});

afterEach(() => {
  vi.useRealTimers();
});

function signInAs(role: string): void {
  holder.user = { member_id: `uid-${role}`, role };
}

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

function linkOnly(): Promise<string> {
  return renderComplete(createElement(RegisterBookLink));
}

function home(q = ""): Promise<string> {
  return renderComplete(createElement(Home, { params: Promise.resolve({}), searchParams: Promise.resolve({ q }) }));
}

describe("F27 · RegisterBookLink · botón «Contenido digital» (regla 15)", () => {
  it("un visitante sin sesión no ve nada", async () => {
    expect(await linkOnly()).toBe("");
  });

  it.each(BORROWERS)("un %s no ve nada", async (role) => {
    signInAs(role);

    expect(await linkOnly()).toBe("");
  });

  it("si falla la lectura de la sesión no se ve nada (ni error)", async () => {
    holder.failRead = true;

    expect(await linkOnly()).toBe("");
  });

  it.each(STAFF)("un %s ve «Registrar libro» y «Contenido digital» con sus destinos", async (role) => {
    signInAs(role);

    const html = await linkOnly();

    expect(linkTexts(html, "/libros/nuevo")).toEqual(["Registrar libro"]);
    expect(linkTexts(html, "/libros/digital")).toEqual(["Contenido digital"]);
    expect(openingTags(html, "a")).toHaveLength(2);
  });

  it("«Contenido digital» va junto a «Registrar libro», después de él", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await linkOnly();

    expect(html.indexOf("Registrar libro")).toBeGreaterThan(-1);
    expect(html.indexOf("Registrar libro")).toBeLessThan(html.indexOf("Contenido digital"));
  });

  it("ambos son enlaces <a> (no <button>) de al menos 44 px", async () => {
    signInAs("ADMINISTRADOR");

    const html = await linkOnly();

    for (const tag of openingTags(html, "a")) {
      expect(attributeOf(tag, "class")).toContain("min-h-11");
    }
    expect(html).not.toContain("<button");
  });

  it("ningún <div> ni <span> lleva texto", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await linkOnly();

    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});

describe("F27 · / · «Contenido digital» y la búsqueda (regla 15)", () => {
  beforeEach(async () => {
    await currentWorld().books.create(aBook({ title: "Rayuela", author: "Julio Cortázar", isbn: "9788437604947" }));
    await currentWorld().books.create(aBook({ title: "Ficciones", author: "Jorge Luis Borges" }));
  });

  it("el marco estático de / no incluye el botón", () => {
    const html = renderToStaticMarkup(
      createElement(Home, { params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
    );

    expect(html).not.toContain("Contenido digital");
    expect(html).not.toContain("/libros/digital");
  });

  it("un visitante ve los libros, sin ninguno de los dos botones", async () => {
    const html = await home();

    expect(html).toContain("Rayuela");
    expect(html).not.toContain("Contenido digital");
    expect(html).not.toContain("/libros/digital");
    expect(html).not.toContain("Registrar libro");
  });

  it.each(BORROWERS)("un %s ve los libros, sin ninguno de los dos botones", async (role) => {
    signInAs(role);

    const html = await home();

    expect(html).toContain("Rayuela");
    expect(html).not.toContain("Contenido digital");
    expect(html).not.toContain("/libros/digital");
    expect(html).not.toContain("Registrar libro");
  });

  it.each(STAFF)("un %s ve «Contenido digital» junto a «Registrar libro», y los libros", async (role) => {
    signInAs(role);

    const html = await home();

    expect(linkTexts(html, "/libros/digital")).toEqual(["Contenido digital"]);
    expect(linkTexts(html, "/libros/nuevo")).toEqual(["Registrar libro"]);
    expect(html).toContain("Rayuela");
    expect(html).toContain("Ficciones");
  });

  it("la búsqueda de «ray» no cambia para el personal", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await home("ray");

    expect(html).toContain("Rayuela");
    expect(html).not.toContain("Ficciones");
  });

  it("el único <h1> sigue siendo «Catálogo» y el botón no está dentro de él", async () => {
    signInAs("ADMINISTRADOR");

    const html = await home();

    expect(html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g)?.map(textOf)).toEqual(["Catálogo"]);
    expect(html).not.toMatch(/<h1\b[^>]*>[\s\S]*?\/libros\/digital[\s\S]*?<\/h1>/);
  });

  it("ningún <div> ni <span> lleva texto, tampoco con los botones", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await home();

    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
