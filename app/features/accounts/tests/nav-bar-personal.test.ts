import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavBar } from "@/features/accounts/ui/nav-bar";
import { ROLES, type Role } from "@/shared/schema";
import { linkTexts } from "@/tests/helpers/html";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderBar(user: { name: string; role: Role } | null): string {
  return renderToStaticMarkup(createElement(NavBar, { user }));
}

describe("F13 · barra · «Personal» solo para el administrador (regla 14)", () => {
  it("el administrador ve «Personal» enlazado a /personal", () => {
    const html = renderBar({ name: "Rosa Admin", role: "ADMINISTRADOR" });
    expect(linkTexts(html, "/personal")).toEqual(["Personal"]);
  });

  it("el administrador conserva «Préstamos», «Cuentas» y «Solicitudes»", () => {
    const html = renderBar({ name: "Rosa Admin", role: "ADMINISTRADOR" });
    expect(linkTexts(html, "/prestamos")).toEqual(["Préstamos"]);
    expect(linkTexts(html, "/cuentas")).toEqual(["Cuentas"]);
    expect(linkTexts(html, "/solicitudes")).toEqual(["Solicitudes"]);
  });

  it("el bibliotecario NO ve «Personal» ni enlaza a /personal", () => {
    const html = renderBar({ name: "Luis Gómez", role: "BIBLIOTECARIO" });
    expect(html).not.toContain("Personal");
    expect(html).not.toContain('href="/personal"');
  });

  it("el bibliotecario conserva «Préstamos», «Cuentas» y «Solicitudes»", () => {
    const html = renderBar({ name: "Luis Gómez", role: "BIBLIOTECARIO" });
    expect(linkTexts(html, "/prestamos")).toEqual(["Préstamos"]);
    expect(linkTexts(html, "/cuentas")).toEqual(["Cuentas"]);
    expect(linkTexts(html, "/solicitudes")).toEqual(["Solicitudes"]);
  });

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("un %s no ve «Personal»", (role) => {
    const html = renderBar({ name: "Ana Pérez", role });
    expect(html).not.toContain("Personal");
    expect(html).not.toContain('href="/personal"');
  });

  it("el visitante sin sesión no ve «Personal»", () => {
    const html = renderBar(null);
    expect(html).not.toContain("Personal");
    expect(html).not.toContain('href="/personal"');
  });

  it("de los cinco roles y el visitante, solo uno tiene el enlace a /personal", () => {
    const withLink = ROLES.filter((role) => renderBar({ name: "Alguien", role }).includes('href="/personal"'));
    expect(withLink).toEqual(["ADMINISTRADOR"]);
  });

  it("«Personal» sale después de «Biblioteca» y de los enlaces del personal", () => {
    const html = renderBar({ name: "Rosa Admin", role: "ADMINISTRADOR" });
    const home = html.indexOf('href="/"');
    const personal = html.indexOf('href="/personal"');
    expect(home).toBeGreaterThanOrEqual(0);
    expect(home).toBeLessThan(personal);
    expect(html.indexOf('href="/cuentas"')).toBeLessThan(personal);
  });

  it("el nombre de una persona llamada «Personal» no cuenta como enlace para el bibliotecario", () => {
    const html = renderBar({ name: "Personal", role: "BIBLIOTECARIO" });
    expect(html).not.toContain('href="/personal"');
    expect(linkTexts(html, "/personal")).toEqual([]);
  });
});
