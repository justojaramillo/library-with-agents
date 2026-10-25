import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewBookPage from "@/libros/nuevo/page";
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
  return renderComplete(createElement(NewBookPage));
}

function signInAs(role: string): void {
  state.user = { member_id: `uid-${role}`, role };
}

describe("F36 · /libros/nuevo · marco estático (regla 1)", () => {
  const html = renderToStaticMarkup(createElement(NewBookPage));

  it("tiene un único <h1> «Registrar libro» que nombra la sección", () => {
    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(textOf(headings[0] ?? "")).toBe("Registrar libro");
    const section = openingTags(html, "section")[0];
    expect(attributeOf(section, "aria-labelledby")).toBe(attributeOf(openingTags(html, "h1")[0], "id"));
  });

  it("mientras lee la sesión anuncia el estado y no pinta el formulario", () => {
    expect(html).toContain("Cargando formulario");
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toContain("Solo para el personal");
  });

  it("incluye el enlace «Volver al catálogo» hacia /", () => {
    expect(linkTexts(html, "/")).toEqual(["Volver al catálogo"]);
  });
});

describe("F36 · /libros/nuevo · quién entra (regla 1 y autorización)", () => {
  it("sin sesión redirige a /login y no muestra el formulario", async () => {
    const html = await screen();

    expect(state.redirected.length).toBeGreaterThan(0);
    expect(new Set(state.redirected)).toEqual(new Set(["/login"]));
    expect(html).not.toMatch(/<form\b/);
  });

  it.each([
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ])("un %s ve «Solo para el personal de la biblioteca.» como alerta y NO ve el formulario", async (role) => {
    signInAs(role);

    const html = await screen();

    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*Solo para el personal de la biblioteca\.\s*<\/p>/);
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<input\b/);
    expect(fieldLabelled(html, "ISBN")).toBeNull();
    expect(buttonLabelled(html, "Registrar libro")).toBeNull();
    expect(state.redirected).toEqual([]);
  });

  it.each(["BIBLIOTECARIO", "ADMINISTRADOR"])("un %s ve el formulario y ningún aviso de acceso", async (role) => {
    signInAs(role);

    const html = await screen();

    expect(openingTags(html, "form")).toHaveLength(1);
    expect(attributeOf(openingTags(html, "form")[0], "aria-label")).toBe("Registrar libro");
    expect(fieldLabelled(html, "ISBN")).not.toBeNull();
    expect(fieldLabelled(html, "Título")).not.toBeNull();
    expect(fieldLabelled(html, "Autor")).not.toBeNull();
    expect(fieldLabelled(html, "Ejemplares")).not.toBeNull();
    expect(buttonLabelled(html, "Registrar libro")).not.toBeNull();
    expect(html).not.toContain("Solo para el personal");
    expect(html).not.toContain('role="alert"');
    expect(state.redirected).toEqual([]);
  });
});

describe("F36 · /libros/nuevo · estructura (regla 12)", () => {
  it.each([
    ["sin sesión", null],
    ["un prestatario", "ESTUDIANTE"],
    ["el personal", "BIBLIOTECARIO"],
  ])("para %s sigue el enlace «Volver al catálogo» a /", async (_nombre, role) => {
    if (role !== null) {
      signInAs(role);
    }

    const html = await screen();

    expect(linkTexts(html, "/")).toEqual(["Volver al catálogo"]);
    const back = openingTags(html, "a").find((tag) => attributeOf(tag, "href") === "/") ?? "";
    expect(attributeOf(back, "class")).toContain("min-h-11");
  });

  it("para el personal hay un solo <h1> y ningún <div> ni <span> lleva texto", async () => {
    signInAs("ADMINISTRADOR");

    const html = await screen();

    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });

  it("para un prestatario hay un solo <h1> y ningún <div> ni <span> lleva texto", async () => {
    signInAs("DOCENTE");

    const html = await screen();

    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
