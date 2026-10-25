import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Member } from "@/features/accounts/schema";
import { ROLES, type Role } from "@/shared/schema";
import { attributeOf, openingTags, textOf } from "@/tests/helpers/html";
import { articlesOf, textOwners } from "@/tests/helpers/html-text";
import { aRow, buttonsOf, stateOf } from "@/tests/helpers/staff-screens";
import { AccountList } from "../ui/account-list";
import type { ActiveActor } from "../ui/active-rules";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderAccounts(members: Member[], actor?: ActiveActor): string {
  return renderToStaticMarkup(createElement(AccountList, { members, actor }));
}

/** Una cuenta por rol, todas activas, con nombres que se distinguen. */
const ALL_ROLES: Member[] = ROLES.map((role) => aRow({ id: `uid-${role}`, name: `Cuenta ${role}`, role }));

/** Texto del botón (o `null`) que la tarjeta de ese nombre ofrece. */
function buttonFor(html: string, name: string): string | null {
  const card = articlesOf(html).find((article) => article.includes(`>${name}</h2>`));
  if (card === undefined) {
    return null;
  }
  return buttonsOf(card)[0]?.text ?? null;
}

describe("F14 · /cuentas sin actor: la lista no ofrece botones (regla 16)", () => {
  const html = renderAccounts(ALL_ROLES);

  it("no pinta ningún botón", () => {
    expect(buttonsOf(html)).toEqual([]);
    expect(html).not.toMatch(/<button\b/);
  });

  it("sigue mostrando una tarjeta por cuenta, con nombre, correo y rol", () => {
    const cards = articlesOf(html);
    expect(cards).toHaveLength(ROLES.length);
    expect(cards[0]).toContain("Cuenta EXTERNO");
    expect(cards[0]).toContain("Externo/a");
    expect(cards[4]).toContain("Administrador/a");
  });

  it("cada cuenta muestra su estado «Activa»", () => {
    for (const card of articlesOf(html)) {
      expect(stateOf(card)).toEqual({ text: "Activa", hasIcon: true });
    }
  });
});

describe("F14 · /cuentas · estado «Activa»/«Inactiva» en cada cuenta (regla 16)", () => {
  it("una cuenta inactiva se muestra («no se ocultan») con «Inactiva» e icono", () => {
    const html = renderAccounts([aRow({ name: "Ana", active: false }), aRow({ name: "Luis", active: true })]);
    const cards = articlesOf(html);
    expect(cards).toHaveLength(2);
    expect(stateOf(cards[0])).toEqual({ text: "Inactiva", hasIcon: true });
    expect(stateOf(cards[1])).toEqual({ text: "Activa", hasIcon: true });
  });

  it("también se muestra el estado sin actor", () => {
    const html = renderAccounts([aRow({ active: false })]);
    expect(stateOf(articlesOf(html)[0])?.text).toBe("Inactiva");
  });
});

describe("F14 · /cuentas · el bibliotecario ve botones solo donde la matriz lo permite (reglas 7 y 16)", () => {
  const actor: ActiveActor = { role: "BIBLIOTECARIO", id: "uid-BIBLIOTECARIO" };
  const html = renderAccounts(ALL_ROLES, actor);

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("ofrece «Desactivar» sobre un %s", (role) => {
    expect(buttonFor(html, `Cuenta ${role}`)).toBe("Desactivar");
  });

  it("no ofrece botón sobre otro bibliotecario (una cuenta distinta de la propia)", () => {
    const other = renderAccounts([aRow({ id: "uid-otro-bib", name: "Otro Bib", role: "BIBLIOTECARIO" })], actor);
    expect(buttonFor(other, "Otro Bib")).toBeNull();
  });

  it("no ofrece botón sobre su propia cuenta", () => {
    expect(buttonFor(html, "Cuenta BIBLIOTECARIO")).toBeNull();
  });

  it("no ofrece botón sobre el administrador", () => {
    expect(buttonFor(html, "Cuenta ADMINISTRADOR")).toBeNull();
  });

  it("muestra exactamente tres botones", () => {
    expect(buttonsOf(html).map((button) => button.label)).toEqual([
      "Desactivar a Cuenta EXTERNO",
      "Desactivar a Cuenta ESTUDIANTE",
      "Desactivar a Cuenta DOCENTE",
    ]);
  });
});

describe("F14 · /cuentas · el administrador (reglas 7 y 16)", () => {
  const actor: ActiveActor = { role: "ADMINISTRADOR", id: "uid-ADMINISTRADOR" };
  const html = renderAccounts(ALL_ROLES, actor);

  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE", "BIBLIOTECARIO"] as const)("ofrece «Desactivar» sobre un %s", (role) => {
    expect(buttonFor(html, `Cuenta ${role}`)).toBe("Desactivar");
  });

  it("no ofrece botón sobre su propia cuenta de administrador", () => {
    expect(buttonFor(html, "Cuenta ADMINISTRADOR")).toBeNull();
  });
});

describe("F14 · /cuentas · los prestatarios nunca ven botones (regla 7)", () => {
  it.each(["EXTERNO", "ESTUDIANTE", "DOCENTE"] as const)("con un actor %s no hay ningún botón", (role) => {
    const html = renderAccounts(ALL_ROLES, { role, id: "uid-ajeno" });
    expect(buttonsOf(html)).toEqual([]);
    expect(articlesOf(html)).toHaveLength(ROLES.length);
  });
});

describe("F14 · /cuentas · cuentas inactivas con «Reactivar» (reglas 15 y 16)", () => {
  const inactive: Member[] = (["ESTUDIANTE", "BIBLIOTECARIO", "ADMINISTRADOR"] as const).map((role) =>
    aRow({ id: `uid-in-${role}`, name: `Inactiva ${role}`, role, active: false }),
  );

  it("el bibliotecario reactiva a un estudiante inactivo (un clic) pero no a personal inactivo", () => {
    const html = renderAccounts(inactive, { role: "BIBLIOTECARIO", id: "uid-yo" });
    expect(buttonFor(html, "Inactiva ESTUDIANTE")).toBe("Reactivar");
    expect(buttonFor(html, "Inactiva BIBLIOTECARIO")).toBeNull();
    expect(buttonFor(html, "Inactiva ADMINISTRADOR")).toBeNull();
    for (const card of articlesOf(html)) {
      expect(stateOf(card)?.text).toBe("Inactiva");
    }
  });

  it("el administrador reactiva a un bibliotecario inactivo, no a otro administrador", () => {
    const html = renderAccounts(inactive, { role: "ADMINISTRADOR", id: "uid-yo" });
    expect(buttonFor(html, "Inactiva ESTUDIANTE")).toBe("Reactivar");
    expect(buttonFor(html, "Inactiva BIBLIOTECARIO")).toBe("Reactivar");
    expect(buttonFor(html, "Inactiva ADMINISTRADOR")).toBeNull();
  });

  it("«Reactivar» lleva aria-label con el texto visible y el nombre, sin segundo paso", () => {
    const html = renderAccounts([aRow({ name: "Ana Pérez", active: false })], { role: "BIBLIOTECARIO", id: "uid-yo" });
    expect(buttonsOf(html)).toEqual([{ text: "Reactivar", label: "Reactivar a Ana Pérez", disabled: false }]);
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Cancelar");
  });
});

describe("F14 · /cuentas · coherencia de la matriz con el rol del actor", () => {
  const roles: readonly Role[] = ROLES;
  for (const actorRole of roles) {
    for (const targetRole of roles) {
      it(`actor ${actorRole} sobre otra cuenta ${targetRole}: botón solo si la regla 7 lo permite`, () => {
        const html = renderAccounts([aRow({ id: "uid-destino", name: "Destino", role: targetRole })], {
          role: actorRole,
          id: "uid-actor",
        });
        let allowed = false;
        if (actorRole === "ADMINISTRADOR") {
          allowed = targetRole !== "ADMINISTRADOR";
        }
        if (actorRole === "BIBLIOTECARIO") {
          allowed = targetRole !== "ADMINISTRADOR" && targetRole !== "BIBLIOTECARIO";
        }
        expect(buttonsOf(html)).toHaveLength(Number(allowed));
      });
    }
  }
});

describe("F14 · /cuentas · texto de personas escapado y HTML semántico", () => {
  const actor: ActiveActor = { role: "ADMINISTRADOR", id: "uid-yo" };

  it("nombre y correo con marcado salen escapados", () => {
    const html = renderAccounts(
      [aRow({ name: "<script>alert(1)</script>", email: "<img src=x onerror=alert(1)>@example.com" })],
      actor,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;@example.com");
  });

  it("ningún <div> ni <span> lleva texto de datos (solo estructura)", () => {
    const html = renderAccounts([...ALL_ROLES, aRow({ name: "Inactiva", active: false })], actor);
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });

  it("va en una lista <ul> con un <li> y un <article> por cuenta y el nombre en un <h2>", () => {
    const html = renderAccounts(ALL_ROLES, actor);
    expect(openingTags(html, "li")).toHaveLength(ROLES.length);
    expect(html).toMatch(/<ul\b[^>]*>\s*<li\b[^>]*>\s*<article\b/);
    expect(textOf(/<h2\b[^>]*>[\s\S]*?<\/h2>/.exec(html)?.[0] ?? "")).toBe("Cuenta EXTERNO");
  });

  it("los botones miden al menos 44 px", () => {
    const html = renderAccounts(ALL_ROLES, actor);
    for (const tag of openingTags(html, "button")) {
      expect(attributeOf(tag, "class")).toContain("min-h-11");
      expect(attributeOf(tag, "class")).toContain("min-w-11");
    }
  });

  it("el aria-label de cada botón contiene su texto visible y el nombre", () => {
    const html = renderAccounts(ALL_ROLES, actor);
    for (const button of buttonsOf(html)) {
      expect(button.label).toContain(button.text);
      expect(button.label).toMatch(/Cuenta [A-Z]+$/);
    }
  });
});
