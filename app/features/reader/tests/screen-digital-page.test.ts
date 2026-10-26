import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DigitalContentPage from "@/libros/digital/page";
import { attributeOf, fieldLabelled, linkTexts, openingTags, textOf } from "@/tests/helpers/html";
import { buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { renderComplete } from "@/tests/helpers/render-page";

// Estado que las simulaciones leen al ejecutarse: la sesión y las llamadas a `redirect`.
const state = vi.hoisted(() => ({
  user: null as { member_id: string; role: string } | null,
  redirected: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (path: string) => {
    state.redirected.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/shared/server/http", () => ({ getSessionUser: async () => state.user }));

beforeEach(() => {
  state.user = null;
  state.redirected = [];
});

function screen(): Promise<string> {
  return renderComplete(createElement(DigitalContentPage));
}

function signInAs(role: string): void {
  state.user = { member_id: `uid-${role}`, role };
}

describe("F27 · /libros/digital · marco estático (regla 13)", () => {
  const html = renderToStaticMarkup(createElement(DigitalContentPage));

  it("tiene un único <h1> «Contenido digital» que nombra la sección", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Contenido digital");
    const section = openingTags(html, "section")[0];
    expect(attributeOf(section, "aria-labelledby")).toBe(attributeOf(openingTags(html, "h1")[0], "id"));
  });

  it("mientras lee la sesión anuncia el estado y no pinta el buscador ni avisos de acceso", () => {
    expect(html).toContain("Cargando pantalla");
    expect(html).not.toContain("Buscar libro");
    expect(html).not.toContain("Solo para el personal");
  });

  it("incluye el enlace «Volver al catálogo» hacia /", () => {
    expect(linkTexts(html, "/")).toEqual(["Volver al catálogo"]);
  });
});

describe("F27 · /libros/digital · quién entra (regla 13 y autorización)", () => {
  it("sin sesión redirige a /login y no muestra el buscador", async () => {
    const html = await screen();

    expect(state.redirected.length).toBeGreaterThan(0);
    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toContain("Buscar libro");
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ])("un %s ve «Solo para el personal de la biblioteca.» como alerta y NO ve el buscador", async (role) => {
    signInAs(role);

    const html = await screen();

    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*Solo para el personal de la biblioteca\.\s*<\/p>/);
    expect(html).not.toContain("Buscar libro");
    expect(buttonLabelled(html, "Buscar")).toBeNull();
    expect(html).not.toMatch(/<input\b/);
    expect(state.redirected).toEqual([]);
  });

  it.each([
    "BIBLIOTECARIO",
    "ADMINISTRADOR",
  ])("un %s ve el buscador de libros y ningún aviso de acceso", async (role) => {
    signInAs(role);

    const html = await screen();

    expect(fieldLabelled(html, "Buscar libro (título o autor)")).not.toBeNull();
    expect(buttonLabelled(html, "Buscar")).not.toBeNull();
    expect(html).not.toContain("Solo para el personal");
    expect(html).not.toContain('role="alert"');
    expect(state.redirected).toEqual([]);
  });

  it("el personal aún no ve los formularios hasta elegir un libro", async () => {
    signInAs("BIBLIOTECARIO");

    const html = await screen();

    expect(buttonLabelled(html, "Guardar copias")).toBeNull();
    expect(buttonLabelled(html, "Subir contenido")).toBeNull();
    expect(html).not.toContain("Libro seleccionado");
  });
});

describe("F27 · /libros/digital · estructura (regla 12 de frontend)", () => {
  it.each([
    ["un prestatario", "ESTUDIANTE"],
    ["el personal", "BIBLIOTECARIO"],
  ])("para %s sigue el enlace «Volver al catálogo» a /, de al menos 44 px", async (_nombre, role) => {
    signInAs(role);

    const html = await screen();

    expect(linkTexts(html, "/")).toEqual(["Volver al catálogo"]);
    const back = openingTags(html, "a").find((tag) => attributeOf(tag, "href") === "/") ?? "";
    expect(attributeOf(back, "class")).toContain("min-h-11");
  });

  it.each([
    "EXTERNO",
    "BIBLIOTECARIO",
  ])("para un %s hay un solo <h1> y ningún <div> ni <span> lleva texto", async (role) => {
    signInAs(role);

    const html = await screen();

    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
