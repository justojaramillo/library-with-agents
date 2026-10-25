import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavBar, NavBarFallback } from "@/features/accounts/ui/nav-bar";
import { ROLE_LABELS } from "@/features/accounts/ui/role-labels";
import { ROLES, type Role } from "@/shared/schema";
import { attributeOf, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { textOwners } from "@/tests/helpers/html-text";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

type Link = { href: string; text: string };
type Person = { name: string; role: Role };

const HOME: Link = { href: "/", text: "Biblioteca" };
const CHANGE_PASSWORD: Link = { href: "/contrasena", text: "Cambiar contraseña" };
const LOANS: Link = { href: "/prestamos", text: "Préstamos" };
const ACCOUNTS: Link = { href: "/cuentas", text: "Cuentas" };
const REQUESTS: Link = { href: "/solicitudes", text: "Solicitudes" };
const STAFF_PAGE: Link = { href: "/personal", text: "Personal" };
const MY_LOANS: Link = { href: "/mis-prestamos", text: "Mis préstamos" };
const MY_OVERDUE: Link = { href: "/mis-vencidos", text: "Mis vencidos" };
const BE_TEACHER: Link = { href: "/docente", text: "Ser docente" };
const IS_TEACHER: Link = { href: "/docente", text: "Mi rol de docente" };

/** Enlaces de navegación esperados por rol (sin «Biblioteca» ni «Cambiar contraseña»), de la regla 10 de F15. */
const ROLE_LINKS: Record<Role, Link[]> = {
  EXTERNO: [MY_LOANS, MY_OVERDUE, BE_TEACHER],
  ESTUDIANTE: [MY_LOANS, MY_OVERDUE, BE_TEACHER],
  DOCENTE: [MY_LOANS, MY_OVERDUE, IS_TEACHER],
  BIBLIOTECARIO: [LOANS, ACCOUNTS, REQUESTS],
  ADMINISTRADOR: [LOANS, ACCOUNTS, REQUESTS, STAFF_PAGE],
};

function renderBar(user: Person | null): string {
  return renderToStaticMarkup(createElement(NavBar, { user }));
}

function renderFor(role: Role, name = "Ana Pérez"): string {
  return renderBar({ name, role });
}

/** Todos los enlaces `<a>` del HTML, en orden. */
function linksOf(html: string): Link[] {
  const found: Link[] = [];
  for (const match of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) {
    found.push({ href: attributeOf(`<a${match[1]}>`, "href") ?? "", text: textOf(match[2]) });
  }
  return found;
}

/** Botones del HTML: su etiqueta de apertura y su texto visible, en orden. */
function buttonsOf(html: string): Array<{ open: string; text: string }> {
  const found: Array<{ open: string; text: string }> = [];
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    found.push({ open: `<button${match[1]}>`, text: textOf(match[2]) });
  }
  return found;
}

/** El botón de «Menú» (enlaces de navegación), o `undefined`. */
function menuButton(html: string): string | undefined {
  return buttonsOf(html).find((button) => button.text === "Menú")?.open;
}

/** El botón que abre el menú de usuario: el que controla `menu-usuario`. */
function userButton(html: string): { open: string; text: string } | undefined {
  return buttonsOf(html).find((button) => attributeOf(button.open, "aria-controls") === "menu-usuario");
}

/** Contenido de la lista (`<ul>`) con ese id; vacío si no existe. */
function listById(html: string, id: string): string {
  return new RegExp(`<ul[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</ul>`).exec(html)?.[1] ?? "";
}

function classesOf(openTag: string | null | undefined): string[] {
  return (attributeOf(openTag ?? "", "class") ?? "").split(/\s+/).filter((token) => token !== "");
}

describe("F15 · menú · visitante sin sesión (regla 10)", () => {
  const html = renderBar(null);

  it("muestra solo «Biblioteca» e «Ingresar», con sus destinos", () => {
    expect(linksOf(html)).toEqual([HOME, { href: "/login", text: "Ingresar" }]);
  });

  it("no tiene ningún botón: ni «Menú» ni menú de usuario ni «Cerrar sesión»", () => {
    expect(buttonsOf(html)).toEqual([]);
    expect(html).not.toContain("Menú");
    expect(html).not.toContain("Cerrar sesión");
    expect(html).not.toContain("Cambiar contraseña");
    expect(html).not.toContain('href="/contrasena"');
  });

  it("no tiene controles desplegables ni listas con los ids de los menús", () => {
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("menu-principal");
    expect(html).not.toContain("menu-usuario");
  });

  it("es una sola lista con dos elementos", () => {
    expect(html.match(/<ul\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(2);
  });

  it("«Ingresar» mide al menos 44 px", () => {
    const login = openingTags(html, "a").find((tag) => attributeOf(tag, "href") === "/login");

    expect(classesOf(login)).toContain("min-h-11");
  });
});

describe("F15 · menú · barra mientras se lee la sesión (F33)", () => {
  const html = renderToStaticMarkup(createElement(NavBarFallback));

  it("muestra solo «Biblioteca»", () => {
    expect(linksOf(html)).toEqual([HOME]);
    expect(buttonsOf(html)).toEqual([]);
    expect(html).not.toContain("Ingresar");
    expect(html).not.toContain("Cerrar sesión");
  });
});

describe("F15 · menú · enlaces exactos por rol (regla 10: nada cambia de destino ni de permiso)", () => {
  it.each(ROLES)("%s ve Biblioteca, sus enlaces del rol y «Cambiar contraseña», en ese orden y nada más", (role) => {
    expect(linksOf(renderFor(role))).toEqual([HOME, ...ROLE_LINKS[role], CHANGE_PASSWORD]);
  });

  it.each(ROLES)("%s no ve «Ingresar» ni enlaza a /login", (role) => {
    const html = renderFor(role);

    expect(html).not.toContain("Ingresar");
    expect(html).not.toContain('href="/login"');
  });

  it("solo el personal ve «Préstamos», «Cuentas» y «Solicitudes»", () => {
    for (const role of ROLES) {
      const hrefs = linksOf(renderFor(role)).map((link) => link.href);
      const isStaff = role === "BIBLIOTECARIO" || role === "ADMINISTRADOR";
      expect(hrefs.includes("/prestamos")).toBe(isStaff);
      expect(hrefs.includes("/cuentas")).toBe(isStaff);
      expect(hrefs.includes("/solicitudes")).toBe(isStaff);
    }
  });

  it("solo el administrador ve «Personal»", () => {
    const withLink = ROLES.filter((role) => renderFor(role).includes('href="/personal"'));

    expect(withLink).toEqual(["ADMINISTRADOR"]);
  });

  it("solo quien pide prestado ve «Mis préstamos», «Mis vencidos» y el enlace de docente", () => {
    for (const role of ROLES) {
      const hrefs = linksOf(renderFor(role)).map((link) => link.href);
      const isBorrower = role === "EXTERNO" || role === "ESTUDIANTE" || role === "DOCENTE";
      expect(hrefs.includes("/mis-prestamos")).toBe(isBorrower);
      expect(hrefs.includes("/mis-vencidos")).toBe(isBorrower);
      expect(hrefs.includes("/docente")).toBe(isBorrower);
    }
  });

  it("un nombre que parece un enlace del personal no crea enlaces", () => {
    const html = renderFor("DOCENTE", "Cuentas Personal Préstamos");

    expect(linksOf(html)).toEqual([HOME, ...ROLE_LINKS.DOCENTE, CHANGE_PASSWORD]);
  });
});

describe("F15 · menú · botón «Menú» de los enlaces (regla 10)", () => {
  it.each(ROLES)("%s lo ve cerrado al empezar, con aria-expanded y aria-controls", (role) => {
    const button = menuButton(renderFor(role));

    expect(button).toBeDefined();
    expect(attributeOf(button ?? "", "type")).toBe("button");
    expect(attributeOf(button ?? "", "aria-expanded")).toBe("false");
    expect(attributeOf(button ?? "", "aria-controls")).toBe("menu-principal");
  });

  it.each(ROLES)("%s: el botón apunta a una lista que existe y contiene los enlaces del rol", (role) => {
    const html = renderFor(role);
    const list = listById(html, "menu-principal");

    expect(tagById(html, "menu-principal")).not.toBeNull();
    expect(linksOf(list)).toEqual(ROLE_LINKS[role]);
  });

  it.each(ROLES)("%s: «Biblioteca» queda fuera de la lista plegable (siempre visible)", (role) => {
    const html = renderFor(role);

    expect(linksOf(listById(html, "menu-principal"))).not.toContainEqual(HOME);
    expect(linksOf(listById(html, "menu-usuario"))).not.toContainEqual(HOME);
  });

  it.each(ROLES)("%s: los enlaces están en el HTML estático, ocultos bajo 768 px y visibles desde md:", (role) => {
    const html = renderFor(role);
    const classes = classesOf(tagById(html, "menu-principal"));

    expect(classes).toContain("hidden");
    expect(classes).toContain("md:flex");
  });

  it.each(ROLES)("%s: el botón «Menú» desaparece desde 768 px (md:hidden)", (role) => {
    expect(classesOf(menuButton(renderFor(role)))).toContain("md:hidden");
  });
});

describe("F15 · menú · menú de usuario (regla 10)", () => {
  it.each(ROLES)("%s: un botón con su nombre y su rol abre el menú, cerrado al empezar", (role) => {
    const html = renderFor(role, "Ana Pérez");
    const button = userButton(html);

    expect(button).toBeDefined();
    expect(attributeOf(button?.open ?? "", "type")).toBe("button");
    expect(attributeOf(button?.open ?? "", "aria-expanded")).toBe("false");
    expect(attributeOf(button?.open ?? "", "aria-controls")).toBe("menu-usuario");
    expect(button?.text).toContain("Ana Pérez");
    expect(button?.text).toContain(ROLE_LABELS[role]);
  });

  it.each(ROLES)("%s: el menú contiene «Cambiar contraseña» enlazada a /contrasena y «Cerrar sesión»", (role) => {
    const html = renderFor(role);
    const list = listById(html, "menu-usuario");

    expect(tagById(html, "menu-usuario")).not.toBeNull();
    expect(linksOf(list)).toEqual([CHANGE_PASSWORD]);
    expect(buttonsOf(list).map((button) => button.text)).toEqual(["Cerrar sesión"]);
  });

  it.each(ROLES)("%s: el menú de usuario está oculto al empezar en cualquier ancho", (role) => {
    const classes = classesOf(tagById(renderFor(role), "menu-usuario"));

    expect(classes).toContain("hidden");
    expect(classes).not.toContain("md:flex");
    expect(classes).not.toContain("lg:flex");
  });

  it.each(ROLES)("%s: los dos menús tienen ids distintos y cada botón controla el suyo", (role) => {
    const html = renderFor(role);
    const controls = buttonsOf(html).map((button) => attributeOf(button.open, "aria-controls"));

    expect(controls.filter((id) => id !== null).sort()).toEqual(["menu-principal", "menu-usuario"]);
    expect(html.match(/\sid="menu-principal"/g)).toHaveLength(1);
    expect(html.match(/\sid="menu-usuario"/g)).toHaveLength(1);
  });

  it.each(ROLES)("%s: «Cerrar sesión» aparece una sola vez y es un botón", (role) => {
    const html = renderFor(role);

    expect(html.match(/Cerrar sesión/g)).toHaveLength(1);
    expect(buttonsOf(html).filter((button) => button.text === "Cerrar sesión")).toHaveLength(1);
  });

  it.each(ROLES)("%s: el rol sale en español, no el código interno", (role) => {
    const html = renderFor(role);

    expect(html).toContain(ROLE_LABELS[role]);
    expect(html).not.toContain(`>${role}<`);
  });
});

describe("F15 · menú · orden de lectura y de tabulación (regla 11)", () => {
  it.each(ROLES)("%s: Biblioteca, botón «Menú», enlaces, menú de usuario", (role) => {
    const html = renderFor(role);
    const order = [
      html.indexOf('href="/"'),
      html.indexOf('aria-controls="menu-principal"'),
      html.indexOf(`href="${ROLE_LINKS[role][0].href}"`),
      html.indexOf('aria-controls="menu-usuario"'),
      html.indexOf('href="/contrasena"'),
      html.indexOf("Cerrar sesión"),
    ];

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("«Cambiar contraseña» va antes de «Cerrar sesión»", () => {
    const html = renderFor("ESTUDIANTE");

    expect(html.indexOf("Cambiar contraseña")).toBeLessThan(html.indexOf("Cerrar sesión"));
  });
});

describe("F15 · menú · nombres largos y con marcado (regla 11)", () => {
  const longName = "N".repeat(120);

  it.each(ROLES)("%s: un nombre de 120 caracteres se muestra completo", (role) => {
    const html = renderFor(role, longName);

    expect(html).toContain(longName);
    expect(userButton(html)?.text).toContain(longName);
  });

  it("el nombre se ajusta: tiene break-words y min-w-0, y el botón no supera el ancho disponible", () => {
    const html = renderFor("BIBLIOTECARIO", longName);
    const nameTag = openingTags(html, "strong")[0];
    const button = userButton(html);
    const userItem = /<li[^>]*>(?=<button[^>]*aria-controls="menu-usuario")/.exec(html)?.[0];

    expect(classesOf(nameTag)).toContain("break-words");
    expect(classesOf(nameTag)).toContain("min-w-0");
    expect(classesOf(button?.open)).toContain("max-w-full");
    expect(classesOf(userItem)).toContain("min-w-0");
    expect(classesOf(userItem)).toContain("max-w-full");
  });

  it("un nombre de 120 caracteres con espacios también se muestra completo", () => {
    const spaced = "María José de los Ángeles ".repeat(5).slice(0, 120);

    expect(spaced).toHaveLength(120);
    expect(renderFor("DOCENTE", spaced)).toContain(spaced.trim());
  });

  it("no hay desborde horizontal: los paneles no superan el ancho de la pantalla", () => {
    const html = renderFor("ADMINISTRADOR", longName);

    expect(classesOf(tagById(html, "menu-usuario"))).toContain("max-w-[calc(100vw-2rem)]");
    expect(classesOf(tagById(html, "menu-principal"))).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("escapa un nombre con marcado: no sale como HTML en ninguna parte de la barra", () => {
    const html = renderFor("ESTUDIANTE", "<script>alert(1)</script>");

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapa comillas y etiquetas de imagen en el nombre", () => {
    const html = renderFor("BIBLIOTECARIO", '"><img src=x onerror=alert(1)>');

    expect(html).not.toContain("<img");
    expect(openingTags(html, "button").every((tag) => !tag.includes("onerror"))).toBe(true);
  });

  it("el nombre no entra en atributos que lo puedan romper (href ni aria-label)", () => {
    const html = renderFor("ESTUDIANTE", '" onclick="alert(1)');

    expect(html).not.toContain('onclick="alert(1)');
    expect(linksOf(html)).toEqual([HOME, ...ROLE_LINKS.ESTUDIANTE, CHANGE_PASSWORD]);
  });
});

describe("F15 · menú · HTML semántico y diseño (regla 11)", () => {
  const people: Array<Person | null> = [null, ...ROLES.map((role) => ({ name: "Ana Pérez", role }))];

  it("ningún div ni span lleva texto, con o sin sesión", () => {
    for (const person of people) {
      const owners = textOwners(renderBar(person));
      expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
    }
  });

  it("no usa div: las listas son <ul>/<li>", () => {
    for (const person of people) {
      expect(renderBar(person)).not.toContain("<div");
    }
  });

  it("cada <li> se cierra: etiquetas balanceadas, con o sin sesión", () => {
    for (const person of people) {
      const html = renderBar(person);
      expect(html.match(/<li\b/g)?.length).toBe(html.match(/<\/li>/g)?.length);
      expect(html.match(/<ul\b/g)?.length).toBe(html.match(/<\/ul>/g)?.length);
    }
  });

  it("los hijos directos de cada lista son <li>: los enlaces y botones van dentro de un elemento de lista", () => {
    for (const role of ROLES) {
      const html = renderFor(role);
      expect(html).not.toMatch(/<ul[^>]*>\s*<(a|button)\b/);
      expect(html).not.toMatch(/<\/li>\s*<(a|button)\b/);
    }
  });

  it("todos los enlaces y botones miden al menos 44 px (min-h-11)", () => {
    for (const person of people) {
      const html = renderBar(person);
      for (const tag of [...openingTags(html, "a"), ...openingTags(html, "button")]) {
        expect(classesOf(tag)).toContain("min-h-11");
      }
    }
  });

  it("solo usa los breakpoints md y lg", () => {
    for (const person of people) {
      expect(renderBar(person)).not.toMatch(/(^|[\s"])(sm|xl|2xl|max-[a-z]+|min-[a-z]+):/);
    }
  });

  it("usa colores solo de la paleta: sin colores de Tailwind por defecto ni valores sueltos", () => {
    const names =
      "white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
    const looseColor = new RegExp(`\\b(bg|text|border|ring|fill|stroke|outline|divide)-(${names})\\b`);

    for (const person of people) {
      const html = renderBar(person);
      expect(html).not.toMatch(looseColor);
      expect(html).not.toMatch(/(bg|text|border)-\[#/);
      expect(html).not.toMatch(/style="/);
    }
  });

  it("el adorno del botón (flecha) es decorativo y no lleva texto", () => {
    const html = renderFor("DOCENTE");

    for (const decoration of html.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)) {
      expect(decoration[0]).toContain('aria-hidden="true"');
      expect(decoration[1].trim()).toBe("");
    }
  });
});
