import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Member } from "@/features/accounts/schema";
import { attributeOf, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, textOwners } from "@/tests/helpers/html-text";
import { aRow, buttonsOf, stateOf } from "@/tests/helpers/staff-screens";
import type { ActiveActor } from "../ui/active-rules";
import { EMPTY_STAFF_TEXT, StaffList } from "../ui/staff-list";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const ADMIN_ACTOR: ActiveActor = { role: "ADMINISTRADOR", id: "uid-admin" };

function renderStaff(members: Member[], actor: ActiveActor = ADMIN_ACTOR): string {
  return renderToStaticMarkup(createElement(StaffList, { members, actor }));
}

const admin = aRow({ id: "uid-admin", name: "Rosa Admin", email: "rosa@example.com", role: "ADMINISTRADOR" });
const librarian = aRow({ id: "uid-bib-1", name: "Luis Gómez", email: "luis@example.com", role: "BIBLIOTECARIO" });
const inactiveLibrarian = aRow({
  id: "uid-bib-2",
  name: "Marta Ruiz",
  email: "marta@example.com",
  role: "BIBLIOTECARIO",
  active: false,
});

describe("F13 · lista de personal · 0, 1 y varias cuentas (regla 13)", () => {
  it("sin personal dice «No hay personal registrado.» y no pinta lista ni tarjetas", () => {
    const html = renderStaff([]);
    expect(EMPTY_STAFF_TEXT).toBe("No hay personal registrado.");
    expect(html).toContain("No hay personal registrado.");
    expect(articlesOf(html)).toHaveLength(0);
    expect(html).not.toMatch(/<ul\b/);
    expect(buttonsOf(html)).toEqual([]);
  });

  it("con una cuenta pinta una lista con un <li> y un <article>, sin el texto de vacío", () => {
    const html = renderStaff([admin]);
    expect(html).toMatch(/<ul\b[^>]*>\s*<li\b[^>]*>\s*<article\b/);
    expect(articlesOf(html)).toHaveLength(1);
    expect(html).not.toContain("No hay personal registrado.");
  });

  it("con varias cuentas pinta una tarjeta por cuenta, en el orden recibido", () => {
    const html = renderStaff([admin, librarian, inactiveLibrarian]);
    const cards = articlesOf(html);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain("Rosa Admin");
    expect(cards[1]).toContain("Luis Gómez");
    expect(cards[2]).toContain("Marta Ruiz");
    expect(openingTags(html, "li")).toHaveLength(3);
  });
});

describe("F13 · tarjeta de una cuenta de personal (regla 13)", () => {
  const html = renderStaff([librarian]);
  const card = articlesOf(html)[0];

  it("el nombre es un <h2>", () => {
    expect(card).toMatch(/<h2\b[^>]*>Luis Gómez<\/h2>/);
  });

  it("muestra el correo y el rol en español", () => {
    expect(card).toContain("luis@example.com");
    expect(card).toContain("Bibliotecario/a");
  });

  it("la cuenta de administrador dice «Administrador/a»", () => {
    expect(articlesOf(renderStaff([admin]))[0]).toContain("Administrador/a");
  });

  it("usa una lista de definición con etiquetas «Correo» y «Rol»", () => {
    expect(card).toMatch(/<dl\b/);
    expect(textOf(card)).toContain("Correo:");
    expect(textOf(card)).toContain("Rol:");
  });
});

describe("F13–F14 · estado de la cuenta con icono y texto (regla 13)", () => {
  it("una cuenta activa dice «Activa» con un icono decorativo", () => {
    const state = stateOf(articlesOf(renderStaff([librarian]))[0]);
    expect(state).toEqual({ text: "Activa", hasIcon: true });
  });

  it("una cuenta inactiva dice «Inactiva» con un icono decorativo (no solo color)", () => {
    const state = stateOf(articlesOf(renderStaff([inactiveLibrarian]))[0]);
    expect(state).toEqual({ text: "Inactiva", hasIcon: true });
  });

  it("el administrador también muestra su estado", () => {
    expect(stateOf(articlesOf(renderStaff([admin]))[0])?.text).toBe("Activa");
  });

  it("cada tarjeta muestra el estado de su propia cuenta", () => {
    const cards = articlesOf(renderStaff([admin, librarian, inactiveLibrarian]));
    expect(cards.map((card) => stateOf(card)?.text)).toEqual(["Activa", "Activa", "Inactiva"]);
  });
});

describe("F13–F14 · botones de estado en la lista de personal (reglas 7 y 15)", () => {
  it("el administrador aparece sin botón", () => {
    const html = renderStaff([admin, librarian]);
    const adminCard = articlesOf(html)[0];
    expect(adminCard).toContain("Rosa Admin");
    expect(buttonsOf(adminCard)).toEqual([]);
  });

  it("un bibliotecario activo, visto por el administrador, tiene «Desactivar» con el nombre en el aria-label", () => {
    const buttons = buttonsOf(articlesOf(renderStaff([librarian]))[0]);
    expect(buttons).toEqual([{ text: "Desactivar", label: "Desactivar a Luis Gómez", disabled: false }]);
  });

  it("un bibliotecario inactivo tiene «Reactivar» (la cuenta inactiva no se oculta)", () => {
    const buttons = buttonsOf(articlesOf(renderStaff([inactiveLibrarian]))[0]);
    expect(buttons).toEqual([{ text: "Reactivar", label: "Reactivar a Marta Ruiz", disabled: false }]);
  });

  it("en una lista mixta solo los bibliotecarios llevan botón", () => {
    const html = renderStaff([admin, librarian, inactiveLibrarian]);
    expect(articlesOf(html).map((card) => buttonsOf(card).map((button) => button.text))).toEqual([
      [],
      ["Desactivar"],
      ["Reactivar"],
    ]);
  });

  it("el aria-label de cada botón contiene su texto visible y el nombre de la persona", () => {
    const html = renderStaff([librarian, inactiveLibrarian]);
    for (const card of articlesOf(html)) {
      const name = textOf(/<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(card)?.[0] ?? "");
      for (const button of buttonsOf(card)) {
        expect(button.label).toContain(button.text);
        expect(button.label).toContain(name);
      }
    }
  });

  it("los botones miden al menos 44 px (min-h-11 y min-w-11)", () => {
    const html = renderStaff([librarian, inactiveLibrarian]);
    for (const tag of openingTags(html, "button")) {
      expect(attributeOf(tag, "class")).toContain("min-h-11");
      expect(attributeOf(tag, "class")).toContain("min-w-11");
    }
  });

  it("el administrador que mira su propia tarjeta no recibe botón aunque sea la única cuenta", () => {
    expect(buttonsOf(renderStaff([admin]))).toEqual([]);
  });

  it("el aviso global no se pinta hasta que haya un cambio", () => {
    const html = renderStaff([librarian]);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});

describe("F13 · nombres largos y texto de personas escapado", () => {
  it("un nombre de 120 caracteres se muestra completo y se parte en líneas (sin desplazamiento horizontal)", () => {
    const name = "N".repeat(120);
    const html = renderStaff([aRow({ role: "BIBLIOTECARIO", name })]);
    expect(html).toContain(name);
    const heading = openingTags(html, "h2")[0];
    expect(attributeOf(heading, "class")).toContain("break-words");
  });

  it("un correo largo (254 caracteres) se muestra completo y se parte en líneas", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(180)}.com`;
    const html = renderStaff([aRow({ role: "BIBLIOTECARIO", email })]);
    expect(html).toContain(email);
    expect(html).toMatch(/<dd\b[^>]*break-words[^>]*>a{64}@/);
  });

  it("un nombre con marcado sale como texto, no como HTML", () => {
    const html = renderStaff([aRow({ role: "BIBLIOTECARIO", name: "<script>alert(1)</script>" })]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("un correo con marcado sale escapado", () => {
    const html = renderStaff([aRow({ role: "BIBLIOTECARIO", email: "<img src=x onerror=alert(1)>@example.com" })]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;@example.com");
  });

  it("un nombre con comillas y marcado no rompe los aria-label de los botones", () => {
    const html = renderStaff([aRow({ role: "BIBLIOTECARIO", name: '"><img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Desactivar a &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
  });
});

describe("F13 · HTML semántico y diseño adaptable de la lista", () => {
  const html = renderStaff([admin, librarian, inactiveLibrarian]);

  it("ningún <div> ni <span> lleva texto de datos (solo estructura)", () => {
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
    expect(owners.length).toBeGreaterThan(0);
  });

  it("solo usa los puntos de ruptura md y lg", () => {
    expect(html).not.toMatch(/\b(sm|xl|2xl):/);
  });
});
