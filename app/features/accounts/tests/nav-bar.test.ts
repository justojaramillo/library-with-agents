import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/features/accounts/ui/logout-button";
import { NavBar } from "@/features/accounts/ui/nav-bar";
import { ROLE_LABELS } from "@/features/accounts/ui/role-labels";
import { ROLES, type Role, STAFF_ROLES } from "@/shared/schema";
import { textOwners } from "@/tests/helpers/html-text";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const BORROWER_AND_EXTERNAL_ROLES: readonly Role[] = ["EXTERNO", "ESTUDIANTE", "DOCENTE"];

/** Pinta la barra a HTML estático, como la vería el navegador antes de hidratar. */
function renderBar(user: { name: string; role: Role } | null): string {
  return renderToStaticMarkup(createElement(NavBar, { user }));
}

/** Enlace `<a>` con ese destino y ese texto visible. */
function hasLink(html: string, href: string, text: string): boolean {
  const pattern = new RegExp(`<a[^>]*href="${href}"[^>]*>[^]*?${text}[^]*?</a>`);
  return pattern.test(html);
}

describe("Barra de navegación · visitante sin sesión", () => {
  const html = renderBar(null);

  it("muestra «Biblioteca» e «Ingresar»", () => {
    expect(html).toContain("Biblioteca");
    expect(html).toContain("Ingresar");
  });

  it("no muestra «Cuentas»", () => {
    expect(html).not.toContain("Cuentas");
  });

  it("no muestra ningún enlace de préstamos (regla 14 de F34–F35)", () => {
    expect(html).not.toContain("Préstamos");
    expect(html).not.toContain("Mis préstamos");
    expect(html).not.toContain("Mis vencidos");
    expect(html).not.toContain('href="/prestamos"');
    expect(html).not.toContain('href="/mis-prestamos"');
    expect(html).not.toContain('href="/mis-vencidos"');
  });

  it("no muestra «Cerrar sesión» ni ningún rol", () => {
    expect(html).not.toContain("Cerrar sesión");
    for (const label of Object.values(ROLE_LABELS)) {
      expect(html).not.toContain(label);
    }
  });

  it("enlaza «Biblioteca» a / e «Ingresar» a /login", () => {
    expect(hasLink(html, "/", "Biblioteca")).toBe(true);
    expect(hasLink(html, "/login", "Ingresar")).toBe(true);
  });
});

describe("Barra de navegación · estructura", () => {
  // Según la interfaz de módulos de F33, `NavBar` entrega la lista de enlaces y el `<nav>` lo pone
  // el layout raíz (regla 1). Se comprueba en el texto del layout, que no se puede pintar sin servidor.
  it("el layout envuelve la barra en una navegación con la etiqueta accesible «Principal»", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../../../layout.tsx"), "utf8");
    expect(layout).toMatch(/<nav[^>]*aria-label="Principal"/);
  });

  it("organiza los enlaces como lista", () => {
    expect(renderBar(null)).toMatch(/<ul[^>]*>[^]*<li[^>]*>[^]*<\/li>[^]*<\/ul>/);
  });
});

describe("Barra de navegación · rol sin permiso de personal con sesión", () => {
  const expectedLabels: Record<string, string> = {
    EXTERNO: "Externo/a",
    ESTUDIANTE: "Estudiante",
    DOCENTE: "Docente",
  };

  for (const role of BORROWER_AND_EXTERNAL_ROLES) {
    describe(role, () => {
      const html = renderBar({ name: "Ana Pérez", role });

      it("muestra el nombre, el rol en español y «Cerrar sesión»", () => {
        expect(html).toContain("Ana Pérez");
        expect(html).toContain(expectedLabels[role]);
        expect(html).toContain("Cerrar sesión");
      });

      it("no muestra «Cuentas» ni «Ingresar»", () => {
        expect(html).not.toContain("Cuentas");
        expect(html).not.toContain("Ingresar");
      });

      it("sigue mostrando el enlace «Biblioteca» a /", () => {
        expect(hasLink(html, "/", "Biblioteca")).toBe(true);
      });

      it("no enlaza a /cuentas", () => {
        expect(html).not.toContain('href="/cuentas"');
      });

      it("muestra «Mis préstamos» a /mis-prestamos y «Mis vencidos» a /mis-vencidos", () => {
        expect(hasLink(html, "/mis-prestamos", "Mis préstamos")).toBe(true);
        expect(hasLink(html, "/mis-vencidos", "Mis vencidos")).toBe(true);
      });

      it("no muestra «Préstamos» del personal ni enlaza a /prestamos", () => {
        expect(html).not.toContain('href="/prestamos"');
        expect(html).not.toContain(">Préstamos<");
      });

      it("ordena los enlaces: Biblioteca · Mis préstamos · Mis vencidos", () => {
        const home = html.indexOf('href="/"');
        const loans = html.indexOf('href="/mis-prestamos"');
        const overdue = html.indexOf('href="/mis-vencidos"');
        expect(home).toBeGreaterThanOrEqual(0);
        expect(home).toBeLessThan(loans);
        expect(loans).toBeLessThan(overdue);
      });
    });
  }

  it("muestra «Cerrar sesión» como botón", () => {
    const html = renderBar({ name: "Ana Pérez", role: "ESTUDIANTE" });
    expect(html).toMatch(/<button[^>]*>[^]*Cerrar sesión[^]*<\/button>/);
  });
});

describe("Barra de navegación · personal con sesión", () => {
  const expectedLabels: Record<string, string> = {
    BIBLIOTECARIO: "Bibliotecario/a",
    ADMINISTRADOR: "Administrador/a",
  };

  for (const role of STAFF_ROLES) {
    describe(role, () => {
      const html = renderBar({ name: "Luis Gómez", role });

      it("muestra además «Cuentas» enlazada a /cuentas", () => {
        expect(hasLink(html, "/cuentas", "Cuentas")).toBe(true);
      });

      it("muestra el nombre, el rol en español y «Cerrar sesión»", () => {
        expect(html).toContain("Luis Gómez");
        expect(html).toContain(expectedLabels[role]);
        expect(html).toContain("Cerrar sesión");
      });

      it("conserva «Biblioteca» y no muestra «Ingresar»", () => {
        expect(hasLink(html, "/", "Biblioteca")).toBe(true);
        expect(html).not.toContain("Ingresar");
      });

      it("muestra además «Préstamos» enlazada a /prestamos", () => {
        expect(hasLink(html, "/prestamos", "Préstamos")).toBe(true);
      });

      it("no muestra «Mis préstamos» ni «Mis vencidos»", () => {
        expect(html).not.toContain("Mis préstamos");
        expect(html).not.toContain("Mis vencidos");
        expect(html).not.toContain('href="/mis-prestamos"');
        expect(html).not.toContain('href="/mis-vencidos"');
      });

      it("ordena los enlaces: Biblioteca · Préstamos · Cuentas", () => {
        const home = html.indexOf('href="/"');
        const loans = html.indexOf('href="/prestamos"');
        const accounts = html.indexOf('href="/cuentas"');
        expect(home).toBeGreaterThanOrEqual(0);
        expect(home).toBeLessThan(loans);
        expect(loans).toBeLessThan(accounts);
      });
    });
  }
});

describe("Etiquetas de rol (ROLE_LABELS)", () => {
  it("cubre exactamente los cinco roles", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
    expect(ROLES).toHaveLength(5);
  });

  it("no deja ninguna etiqueta vacía", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].trim().length).toBeGreaterThan(0);
    }
  });

  it("usa los textos en español de la especificación", () => {
    expect(ROLE_LABELS).toEqual({
      EXTERNO: "Externo/a",
      ESTUDIANTE: "Estudiante",
      DOCENTE: "Docente",
      BIBLIOTECARIO: "Bibliotecario/a",
      ADMINISTRADOR: "Administrador/a",
    });
  });
});

describe("Barra de navegación · nombres", () => {
  it("escapa un nombre con marcado: no sale como HTML", () => {
    const html = renderBar({ name: "<script>alert(1)</script>", role: "ESTUDIANTE" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapa comillas y etiquetas de imagen en el nombre", () => {
    const html = renderBar({ name: '"><img src=x onerror=alert(1)>', role: "DOCENTE" });
    expect(html).not.toContain("<img");
  });

  it("un nombre de 200 caracteres se muestra completo sin romper el marcado", () => {
    const longName = "A".repeat(200);
    const html = renderBar({ name: longName, role: "BIBLIOTECARIO" });
    // F15 (reglas 10–11): la barra tiene listas anidadas (enlaces y menú de usuario), así que no se cuenta `<ul`.
    expect(html).toContain(longName);
    expect(html.match(/<li\b/g)?.length).toBe(html.match(/<\/li>/g)?.length);
    expect(html.match(/<ul\b/g)?.length).toBe(html.match(/<\/ul>/g)?.length);
    expect(html.match(/<button\b/g)?.length).toBe(html.match(/<\/button>/g)?.length);
    expect(html).toContain("Cerrar sesión");
    expect(html).toContain("Bibliotecario/a");
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});

describe("Botón «Cerrar sesión»", () => {
  it("se pinta como un botón con su texto", () => {
    const html = renderToStaticMarkup(createElement(LogoutButton));
    expect(html).toMatch(/<button[^>]*>[^]*Cerrar sesión[^]*<\/button>/);
  });
});
