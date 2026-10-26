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
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/shared/server/http", () => ({ getSessionUser: async () => holder.user }));
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

/** El HTML sin los botones del personal (para comparar lo demás). F27 (regla 15) añade «Contenido digital» junto a «Registrar libro». */
function withoutRegisterLink(html: string): string {
  return html
    .replace(/<a\b[^>]*href="\/libros\/nuevo"[^>]*>\s*Registrar libro\s*<\/a>/g, "")
    .replace(/<div\b[^>]*>\s*(?:<a\b[^>]*href="\/libros\/digital"[^>]*>\s*Contenido digital\s*<\/a>)\s*<\/div>/g, "");
}

describe("F36 · RegisterBookLink (regla 12)", () => {
  it("un visitante sin sesión no ve nada", async () => {
    expect(await linkOnly()).toBe("");
  });

  it.each(BORROWERS)("un %s no ve nada", async (role) => {
    signInAs(role);

    expect(await linkOnly()).toBe("");
  });

  it.each(STAFF)("un %s ve el enlace «Registrar libro» hacia /libros/nuevo", async (role) => {
    signInAs(role);

    const html = await linkOnly();

    expect(linkTexts(html, "/libros/nuevo")).toEqual(["Registrar libro"]);
    // F27 (regla 15): junto a «Registrar libro» va «Contenido digital».
    expect(linkTexts(html, "/libros/digital")).toEqual(["Contenido digital"]);
    expect(openingTags(html, "a")).toHaveLength(2);
  });

  it("el enlace mide al menos 44 px y es una <a>, no un <button>", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await linkOnly();

    expect(attributeOf(openingTags(html, "a")[0], "class")).toContain("min-h-11");
    expect(html).not.toContain("<button");
  });
});

describe("F36 · / · el botón «Registrar libro» y la búsqueda (regla 12)", () => {
  beforeEach(async () => {
    await currentWorld().books.create(aBook({ title: "Rayuela", author: "Julio Cortázar", isbn: "9788437604947" }));
    await currentWorld().books.create(aBook({ title: "Ficciones", author: "Jorge Luis Borges" }));
  });

  it("el marco estático de / no incluye el botón y conserva el título y la carga del catálogo", () => {
    const html = renderToStaticMarkup(
      createElement(Home, { params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
    );

    expect(html).not.toContain("Registrar libro");
    expect(html).not.toContain("/libros/nuevo");
    expect(html).toContain("Cargando catálogo");
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(textOf(/<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(html)?.[0] ?? "")).toBe("Catálogo");
  });

  it("un visitante ve la búsqueda y los libros, sin el botón", async () => {
    const html = await home();

    expect(html).toContain("Rayuela");
    expect(html).toContain("Ficciones");
    expect(html).not.toContain("Registrar libro");
    expect(html).not.toContain("/libros/nuevo");
  });

  it.each(BORROWERS)("un %s ve la búsqueda y los libros, sin el botón", async (role) => {
    signInAs(role);

    const html = await home();

    expect(html).toContain("Rayuela");
    expect(html).not.toContain("Registrar libro");
    expect(html).not.toContain("/libros/nuevo");
  });

  it.each(STAFF)("un %s ve el botón «Registrar libro» además de la búsqueda y los libros", async (role) => {
    signInAs(role);

    const html = await home();

    expect(linkTexts(html, "/libros/nuevo")).toEqual(["Registrar libro"]);
    expect(html).toContain("Rayuela");
    expect(html).toContain("Ficciones");
  });

  it.each(STAFF)("la página de un %s es igual a la del visitante salvo por el botón", async (role) => {
    const visitor = await home();
    resetRateLimits();
    signInAs(role);

    const staff = await home();

    expect(withoutRegisterLink(staff)).toBe(visitor);
  });

  it.each([...BORROWERS, ...STAFF])("la búsqueda de «ray» da el mismo resultado para %s", async (role) => {
    signInAs(role);

    const html = await home("ray");

    expect(html).toContain("Rayuela");
    expect(html).not.toContain("Ficciones");
  });

  it("un libro recién registrado aparece al buscarlo", async () => {
    await currentWorld().books.create(aBook({ title: "Pedro Páramo", author: "Juan Rulfo" }));
    signInAs("BIBLIOTECARIO");

    const html = await home("páramo");

    expect(html).toContain("Pedro Páramo");
    expect(html).not.toContain("Rayuela");
  });

  it("el botón vive junto al título y el único <h1> sigue siendo «Catálogo»", async () => {
    signInAs("ADMINISTRADOR");

    const html = await home();

    expect(html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g)?.map(textOf)).toEqual(["Catálogo"]);
    expect(html.indexOf("Catálogo")).toBeLessThan(html.indexOf("/libros/nuevo"));
    expect(html).not.toMatch(/<h1\b[^>]*>[\s\S]*?\/libros\/nuevo[\s\S]*?<\/h1>/);
  });

  it("ningún <div> ni <span> lleva texto, tampoco con el botón", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await home();

    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });

  it("para el personal tampoco aparece «Nueva cuenta» en /", async () => {
    signInAs("ADMINISTRADOR");

    expect(await home()).not.toContain("Nueva cuenta");
  });
});
