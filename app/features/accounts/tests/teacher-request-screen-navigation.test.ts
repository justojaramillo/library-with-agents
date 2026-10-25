import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountPagination, buildPageHref, PageNotFound } from "@/features/accounts/ui/account-pagination";
import { NavBar } from "@/features/accounts/ui/nav-bar";
import { type Role, STAFF_ROLES } from "@/shared/schema";
import { attributeOf, linkTexts, openingTags, textOf } from "@/tests/helpers/html";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

type Target = { basePath?: string; extraParams?: Record<string, string>; label?: string };

function pagination(nextAfter: string | null, hasCursor: boolean, target: Target = {}): string {
  return renderToStaticMarkup(createElement(AccountPagination, { nextAfter, hasCursor, ...target }));
}

function notFound(target: Target = {}): string {
  return renderToStaticMarkup(createElement(PageNotFound, target));
}

/** Direcciones de los enlaces del HTML, con `&amp;` ya convertido a `&`. */
function hrefsOf(html: string): string[] {
  return openingTags(html, "a").map((link) => (attributeOf(link, "href") ?? "").replace(/&amp;/g, "&"));
}

function queryOf(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

describe("F37 · buildPageHref", () => {
  it("sin parámetros devuelve la ruta sola", () => {
    expect(buildPageHref("/cuentas", {})).toBe("/cuentas");
    expect(buildPageHref("/solicitudes", {})).toBe("/solicitudes");
  });

  it("con parámetros los une en la consulta, en orden", () => {
    expect(buildPageHref("/solicitudes", { status: "APROBADA", after: "uid-1" })).toBe(
      "/solicitudes?status=APROBADA&after=uid-1",
    );
  });

  it("codifica los valores con encodeURIComponent", () => {
    expect(buildPageHref("/cuentas", { after: "a b/c&d=é" })).toBe(`/cuentas?after=${encodeURIComponent("a b/c&d=é")}`);
    expect(buildPageHref("/cuentas", { after: "a b/c&d=é" })).toBe("/cuentas?after=a%20b%2Fc%26d%3D%C3%A9");
  });
});

describe("F37 · paginación de /cuentas queda igual (valores por defecto)", () => {
  it("con página siguiente: «Siguiente» a /cuentas?after=… y navegación «Paginación de cuentas»", () => {
    const html = pagination("uid-50", false);
    expect(attributeOf(openingTags(html, "nav")[0], "aria-label")).toBe("Paginación de cuentas");
    expect(hrefsOf(html)).toEqual(["/cuentas?after=uid-50"]);
    expect(linkTexts(html, "/cuentas?after=uid-50")).toEqual(["Siguiente"]);
    expect(html).not.toContain("Volver al inicio");
  });

  it("con cursor y última página: solo «Volver al inicio» a /cuentas", () => {
    const html = pagination(null, true);
    expect(hrefsOf(html)).toEqual(["/cuentas"]);
    expect(linkTexts(html, "/cuentas")).toEqual(["Volver al inicio"]);
    expect(html).not.toContain("Siguiente");
  });

  it("con cursor y siguiente: «Volver al inicio» antes de «Siguiente»", () => {
    const html = pagination("uid-100", true);
    expect(hrefsOf(html)).toEqual(["/cuentas", "/cuentas?after=uid-100"]);
    expect(html.indexOf("Volver al inicio")).toBeLessThan(html.indexOf("Siguiente"));
  });

  it("una sola página (sin cursor ni siguiente): no pinta nada", () => {
    expect(pagination(null, false)).toBe("");
  });

  it("codifica el cursor", () => {
    const html = pagination("a b/c&d", false);
    expect(hrefsOf(html)).toEqual(["/cuentas?after=a%20b%2Fc%26d"]);
  });

  it("los enlaces miden al menos 44 px", () => {
    for (const link of openingTags(pagination("uid-1", true), "a")) {
      expect(attributeOf(link, "class")).toContain("min-h-11");
      expect(attributeOf(link, "class")).toContain("min-w-11");
    }
  });

  it("los enlaces van en una lista", () => {
    expect(pagination("uid-1", true)).toMatch(/<ul\b[^>]*>\s*<li\b[\s\S]*<\/li>\s*<\/ul>/);
  });
});

describe("F37 · aviso de página inexistente de /cuentas queda igual", () => {
  const html = notFound();

  it("dice «No se encontró esa página. Vuelve al inicio.» como alerta", () => {
    expect(html).toMatch(/<p\b[^>]*role="alert"[^>]*>\s*No se encontró esa página\. Vuelve al inicio\.\s*<\/p>/);
  });

  it("ofrece «Volver al inicio» a /cuentas en la navegación «Paginación de cuentas»", () => {
    expect(hrefsOf(html)).toEqual(["/cuentas"]);
    expect(linkTexts(html, "/cuentas")).toEqual(["Volver al inicio"]);
    expect(attributeOf(openingTags(html, "nav")[0], "aria-label")).toBe("Paginación de cuentas");
  });
});

describe("F37 · paginación de /solicitudes (ruta base y parámetros que se conservan)", () => {
  const target = { basePath: "/solicitudes", extraParams: { status: "APROBADA" }, label: "Paginación de solicitudes" };

  it("«Siguiente» conserva status y lleva after", () => {
    const html = pagination("uid-50", false, target);
    const [href] = hrefsOf(html);
    expect(href.startsWith("/solicitudes?")).toBe(true);
    expect(queryOf(href).get("status")).toBe("APROBADA");
    expect(queryOf(href).get("after")).toBe("uid-50");
  });

  it("«Volver al inicio» conserva status y no lleva after", () => {
    const html = pagination(null, true, target);
    const [href] = hrefsOf(html);
    expect(queryOf(href).get("status")).toBe("APROBADA");
    expect(queryOf(href).has("after")).toBe(false);
    expect(href.startsWith("/solicitudes")).toBe(true);
  });

  it("con cursor y siguiente hay dos enlaces, ambos con status", () => {
    const hrefs = hrefsOf(pagination("uid-2", true, target));
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      expect(queryOf(href).get("status")).toBe("APROBADA");
    }
  });

  it("codifica after con encodeURIComponent y se lee de vuelta igual", () => {
    const [href] = hrefsOf(pagination("a b/c&d=é", false, target));
    expect(href).toContain(`after=${encodeURIComponent("a b/c&d=é")}`);
    expect(queryOf(href).get("after")).toBe("a b/c&d=é");
    expect(queryOf(href).get("status")).toBe("APROBADA");
  });

  it("en el HTML el & del enlace va escapado como &amp;", () => {
    const html = pagination("uid-1", false, target);
    expect(html).toContain("status=APROBADA&amp;after=uid-1");
  });

  it("usa el nombre accesible que se le pasa", () => {
    const html = pagination("uid-1", false, target);
    expect(attributeOf(openingTags(html, "nav")[0], "aria-label")).toBe("Paginación de solicitudes");
    expect(html).not.toContain("Paginación de cuentas");
  });

  it("solo con basePath (sin parámetros) usa esa ruta", () => {
    expect(hrefsOf(pagination("uid-1", false, { basePath: "/solicitudes" }))).toEqual(["/solicitudes?after=uid-1"]);
  });

  it("una sola página sigue sin pintar nada", () => {
    expect(pagination(null, false, target)).toBe("");
  });

  it("el aviso de página inexistente vuelve a /solicitudes conservando status", () => {
    const html = notFound(target);
    const [href] = hrefsOf(html);
    expect(href.startsWith("/solicitudes?")).toBe(true);
    expect(queryOf(href).get("status")).toBe("APROBADA");
    expect(html).toContain("No se encontró esa página. Vuelve al inicio.");
    expect(html).toMatch(/role="alert"/);
    expect(attributeOf(openingTags(html, "nav")[0], "aria-label")).toBe("Paginación de solicitudes");
    expect(linkTexts(html, "/solicitudes?status=APROBADA")).toEqual(["Volver al inicio"]);
  });
});

describe("F37 · barra de navegación · enlace «Solicitudes» (regla 12)", () => {
  function bar(user: { name: string; role: Role } | null): string {
    return renderToStaticMarkup(createElement(NavBar, { user }));
  }

  function solicitudesTexts(html: string): string[] {
    return linkTexts(html, "/solicitudes");
  }

  it.each(STAFF_ROLES)("el %s ve «Solicitudes» enlazada a /solicitudes", (role) => {
    expect(solicitudesTexts(bar({ name: "Luis Gómez", role }))).toEqual(["Solicitudes"]);
  });

  it.each(STAFF_ROLES)("el %s conserva «Préstamos» y «Cuentas»", (role) => {
    const html = bar({ name: "Luis Gómez", role });
    expect(linkTexts(html, "/prestamos")).toEqual(["Préstamos"]);
    expect(linkTexts(html, "/cuentas")).toEqual(["Cuentas"]);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("el %s no ve «Solicitudes»", (role) => {
    const html = bar({ name: "Ana Pérez", role });
    expect(html).not.toContain("Solicitudes");
    expect(html).not.toContain('href="/solicitudes"');
  });

  it("sin sesión no hay «Solicitudes»", () => {
    const html = bar(null);
    expect(html).not.toContain("Solicitudes");
    expect(html).not.toContain('href="/solicitudes"');
  });

  it("el enlace no lleva contador: su texto es exactamente «Solicitudes»", () => {
    const html = bar({ name: "Luis Gómez", role: "BIBLIOTECARIO" });
    const link = /<a\b[^>]*href="\/solicitudes"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    expect(link).not.toBeNull();
    expect(textOf(link?.[1] ?? "")).toBe("Solicitudes");
    expect(link?.[1]).not.toMatch(/\d/);
  });

  it("el enlace va dentro de un elemento de lista", () => {
    const html = bar({ name: "Luis Gómez", role: "ADMINISTRADOR" });
    expect(html).toMatch(/<li\b[^>]*>\s*<a\b[^>]*href="\/solicitudes"/);
  });
});
