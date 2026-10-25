import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "@/features/accounts/ui/change-password-form";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const EMAIL = "ana.formulario@example.com";
const html = renderToStaticMarkup(createElement(ChangePasswordForm, { email: EMAIL }));

/** Etiqueta de apertura del botón con ese texto visible, o `null`. */
function buttonTag(source: string, text: string): string | null {
  for (const match of source.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === text) {
      return `<button${match[1]}>`;
    }
  }
  return null;
}

describe("F15 · Formulario «Cambiar contraseña» · campos (regla 2)", () => {
  const expectedFields = [
    { label: "Contraseña actual", name: "current_password", autocomplete: "current-password" },
    { label: "Nueva contraseña", name: "new_password", autocomplete: "new-password" },
    { label: "Confirmar nueva contraseña", name: "confirm_password", autocomplete: "new-password" },
  ];

  for (const expected of expectedFields) {
    it(`«${expected.label}» está enlazada a un campo de contraseña con name ${expected.name} y autocomplete ${expected.autocomplete}`, () => {
      const field = fieldLabelled(html, expected.label);

      expect(field).not.toBeNull();
      expect(attributeOf(field ?? "", "type")).toBe("password");
      expect(attributeOf(field ?? "", "name")).toBe(expected.name);
      expect(attributeOf(field ?? "", "autocomplete")).toBe(expected.autocomplete);
    });
  }

  it("tiene exactamente tres campos y todos son de contraseña (no hay campo de texto ni de correo)", () => {
    const inputs = openingTags(html, "input");

    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(attributeOf(input, "type")).toBe("password");
    }
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('type="hidden"');
  });

  it("no ofrece mostrar la contraseña: ni casilla ni botón extra", () => {
    expect(html).not.toContain('type="checkbox"');
    expect(openingTags(html, "button")).toHaveLength(1);
    expect(html.toLowerCase()).not.toContain("mostrar");
  });

  it("todos los campos tienen etiqueta, id único y el mismo id que su name", () => {
    const ids = openingTags(html, "input").map((tag) => attributeOf(tag, "id"));

    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).not.toBeNull();
      expect(html).toMatch(new RegExp(`<label[^>]*\\sfor="${id}"`));
    }
  });

  it("el orden es: actual, nueva y confirmación", () => {
    const names = openingTags(html, "input").map((tag) => attributeOf(tag, "name"));

    expect(names).toEqual(["current_password", "new_password", "confirm_password"]);
  });

  it("los campos miden al menos 44 px de alto (min-h-11)", () => {
    for (const input of openingTags(html, "input")) {
      expect(attributeOf(input, "class")).toContain("min-h-11");
    }
  });
});

describe("F15 · Formulario «Cambiar contraseña» · ayuda (regla 2)", () => {
  it("muestra «Entre 8 y 100 caracteres» enlazada al campo de la nueva contraseña", () => {
    const field = fieldLabelled(html, "Nueva contraseña") ?? "";
    const helpId = attributeOf(field, "aria-describedby");

    expect(helpId).not.toBeNull();
    const help = new RegExp(`<[a-z]+[^>]*\\sid="${helpId}"[^>]*>([^<]*)<`).exec(html);
    expect(help?.[1]).toBe("Entre 8 y 100 caracteres");
  });

  it("la ayuda aparece una sola vez", () => {
    expect(html.match(/Entre 8 y 100 caracteres/g)).toHaveLength(1);
  });

  it("la ayuda va después de la nueva contraseña y antes de la confirmación", () => {
    expect(html.indexOf("Nueva contraseña")).toBeLessThan(html.indexOf("Entre 8 y 100 caracteres"));
    expect(html.indexOf("Entre 8 y 100 caracteres")).toBeLessThan(html.indexOf("Confirmar nueva contraseña"));
  });
});

describe("F15 · Formulario «Cambiar contraseña» · botón (regla 2)", () => {
  it("tiene el botón de envío «Cambiar contraseña», habilitado y de al menos 44 px", () => {
    const button = buttonTag(html, "Cambiar contraseña");

    expect(button).not.toBeNull();
    expect(attributeOf(button ?? "", "type")).toBe("submit");
    expect(hasAttribute(button ?? "", "disabled")).toBe(false);
    expect(attributeOf(button ?? "", "class")).toContain("min-h-11");
  });

  it("el botón va al final del formulario", () => {
    expect(html.lastIndexOf("<input")).toBeLessThan(html.indexOf("<button"));
  });
});

describe("F15 · Formulario «Cambiar contraseña» · estado inicial (regla 3 y criterios de accesibilidad)", () => {
  it("no muestra mensajes de error ni de estado", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Tu contraseña se cambió");
    expect(html).not.toContain("Las contraseñas no coinciden.");
    expect(html).not.toContain("La contraseña actual es incorrecta.");
    expect(html).not.toContain("Escribe tu contraseña actual.");
    expect(html).not.toContain("Ir a ingresar");
  });

  it("el formulario no apunta a un mensaje que todavía no existe (sin aria-describedby)", () => {
    const form = openingTags(html, "form")[0];

    expect(form).toBeDefined();
    expect(attributeOf(form, "aria-describedby")).toBeNull();
    expect(tagById(html, "contrasena-mensaje")).toBeNull();
  });

  it("no está marcado como ocupado al empezar", () => {
    const form = openingTags(html, "form")[0];

    expect(attributeOf(form, "aria-busy")).not.toBe("true");
  });
});

describe("F15 · Formulario «Cambiar contraseña» · nunca pinta una contraseña (regla 7)", () => {
  it("ningún campo trae valor precargado", () => {
    for (const input of openingTags(html, "input")) {
      expect(hasAttribute(input, "value")).toBe(false);
      expect(hasAttribute(input, "defaultvalue")).toBe(false);
    }
  });

  it("el correo recibido no se pinta como campo editable ni oculto", () => {
    expect(openingTags(html, "input").some((tag) => tag.includes(EMAIL))).toBe(false);
    expect(openingTags(html, "textarea")).toEqual([]);
  });
});

describe("F15 · Formulario «Cambiar contraseña» · semántica", () => {
  it("el contenido es un único <form> y no usa div ni span con texto", () => {
    expect(openingTags(html, "form")).toHaveLength(1);
    for (const piece of html.matchAll(/<(div|span)\b[^>]*>([^<]+)</g)) {
      expect(piece[2].trim()).toBe("");
    }
  });

  it("solo usa los breakpoints md y lg", () => {
    expect(html).not.toMatch(/\b(sm|xl|2xl):/);
  });
});
