import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/features/accounts/ui/forgot-password-form";
import { LoginForm } from "@/features/accounts/ui/login-form";
import { RegisterForm } from "@/features/accounts/ui/register-form";
import RecuperarPage from "@/recuperar/page";
import RegistroPage from "@/registro/page";
import {
  attributeOf,
  fieldLabelled,
  hasAttribute,
  linkTexts,
  openingTags,
  tagById,
  textOf,
} from "@/tests/helpers/html";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const registerHtml = renderToStaticMarkup(createElement(RegisterForm));
const forgotHtml = renderToStaticMarkup(createElement(ForgotPasswordForm));
const loginHtml = renderToStaticMarkup(createElement(LoginForm));

/** Etiqueta de apertura del botón de envío con ese texto, o `null`. */
function submitButton(html: string, text: string): string | null {
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (textOf(match[2]) === text) {
      return `<button${match[1]}>`;
    }
  }
  return null;
}

function expectNoMessages(html: string) {
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain('role="status"');
}

describe("F10 · Formulario «Crear cuenta» · render inicial (reglas 6 y 20)", () => {
  const expectedFields: Array<{ label: string; type: string; autocomplete: string }> = [
    { label: "Nombre", type: "text", autocomplete: "name" },
    { label: "Correo", type: "email", autocomplete: "email" },
    { label: "Contraseña", type: "password", autocomplete: "new-password" },
    { label: "Confirmar contraseña", type: "password", autocomplete: "new-password" },
  ];

  for (const expected of expectedFields) {
    it(`«${expected.label}» tiene su etiqueta enlazada a un campo ${expected.type} con autocomplete ${expected.autocomplete}`, () => {
      const field = fieldLabelled(registerHtml, expected.label);
      expect(field).not.toBeNull();
      expect(attributeOf(field ?? "", "type")).toBe(expected.type);
      expect(attributeOf(field ?? "", "autocomplete")).toBe(expected.autocomplete);
    });
  }

  it("el nombre es obligatorio", () => {
    expect(hasAttribute(fieldLabelled(registerHtml, "Nombre") ?? "", "required")).toBe(true);
  });

  it("muestra la ayuda «Entre 8 y 100 caracteres» enlazada a la contraseña", () => {
    expect(registerHtml).toContain("Entre 8 y 100 caracteres");
    const password = fieldLabelled(registerHtml, "Contraseña") ?? "";
    const helpId = attributeOf(password, "aria-describedby");
    expect(helpId).not.toBeNull();
    const help = new RegExp(`<[a-z]+[^>]*\\sid="${helpId}"[^>]*>([^<]*)<`).exec(registerHtml);
    expect(help?.[1]).toContain("Entre 8 y 100 caracteres");
  });

  it("agrupa el rol en un fieldset con la leyenda «Soy»", () => {
    expect(registerHtml).toMatch(/<fieldset[^>]*>\s*<legend[^>]*>Soy<\/legend>/);
  });

  it("ofrece dos radios: «Externo» (marcado por defecto) y «Estudiante» (sin marcar)", () => {
    const radios = openingTags(registerHtml, "input").filter((tag) => attributeOf(tag, "type") === "radio");
    expect(radios).toHaveLength(2);
    const external = fieldLabelled(registerHtml, "Externo");
    const student = fieldLabelled(registerHtml, "Estudiante");
    expect(attributeOf(external ?? "", "type")).toBe("radio");
    expect(attributeOf(student ?? "", "type")).toBe("radio");
    expect(hasAttribute(external ?? "", "checked")).toBe(true);
    expect(hasAttribute(student ?? "", "checked")).toBe(false);
  });

  it("los dos radios comparten grupo (mismo name) y no ofrecen otros roles", () => {
    const external = fieldLabelled(registerHtml, "Externo") ?? "";
    const student = fieldLabelled(registerHtml, "Estudiante") ?? "";
    expect(attributeOf(external, "name")).not.toBeNull();
    expect(attributeOf(external, "name")).toBe(attributeOf(student, "name"));
    for (const forbidden of ["Docente", "Bibliotecario", "Administrador"]) {
      expect(registerHtml).not.toContain(forbidden);
    }
  });

  it("tiene el botón de envío «Crear cuenta», habilitado", () => {
    const button = submitButton(registerHtml, "Crear cuenta");
    expect(button).not.toBeNull();
    expect(attributeOf(button ?? "", "type")).toBe("submit");
    expect(hasAttribute(button ?? "", "disabled")).toBe(false);
  });

  it("enlaza «¿Ya tienes cuenta? Ingresar» a /login", () => {
    expect(registerHtml).toContain("¿Ya tienes cuenta?");
    expect(linkTexts(registerHtml, "/login")).toContain("Ingresar");
  });

  it("no muestra ningún mensaje de error ni de estado al inicio", () => {
    expectNoMessages(registerHtml);
    expect(registerHtml).not.toContain("Las contraseñas no coinciden.");
    expect(registerHtml).not.toContain("Tu cuenta se creó");
  });

  it("todos los campos tienen etiqueta y los controles tienen id único", () => {
    const ids = openingTags(registerHtml, "input")
      .map((tag) => attributeOf(tag, "id"))
      .filter((id) => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(registerHtml).toMatch(new RegExp(`<label[^>]*\\sfor="${id}"`));
    }
  });
});

describe("F16 · Formulario «Recuperar contraseña» · render inicial (regla 9)", () => {
  it("«Correo» está enlazada a un campo de correo con autocomplete email", () => {
    const field = fieldLabelled(forgotHtml, "Correo");
    expect(attributeOf(field ?? "", "type")).toBe("email");
    expect(attributeOf(field ?? "", "autocomplete")).toBe("email");
  });

  it("tiene el botón de envío «Enviar enlace», habilitado", () => {
    const button = submitButton(forgotHtml, "Enviar enlace");
    expect(button).not.toBeNull();
    expect(attributeOf(button ?? "", "type")).toBe("submit");
    expect(hasAttribute(button ?? "", "disabled")).toBe(false);
  });

  it("enlaza a /login y a /registro", () => {
    expect(linkTexts(forgotHtml, "/login")).toHaveLength(1);
    expect(linkTexts(forgotHtml, "/registro")).toHaveLength(1);
  });

  it("no muestra ningún mensaje de error ni de estado al inicio", () => {
    expectNoMessages(forgotHtml);
    expect(forgotHtml).not.toContain("Si el correo está registrado");
    expect(forgotHtml).not.toContain("Escribe un correo válido.");
  });

  it("solo pide el correo: no hay campo de contraseña", () => {
    expect(forgotHtml).not.toContain('type="password"');
  });
});

describe("F4 · F17 · Formulario «Ingresar» · render inicial (reglas 15–16)", () => {
  it("«Correo» (email) y «Contraseña» (current-password) están enlazados a sus campos", () => {
    const email = fieldLabelled(loginHtml, "Correo");
    const password = fieldLabelled(loginHtml, "Contraseña");
    expect(attributeOf(email ?? "", "autocomplete")).toBe("email");
    expect(attributeOf(password ?? "", "type")).toBe("password");
    expect(attributeOf(password ?? "", "autocomplete")).toBe("current-password");
  });

  it("tiene el botón de envío «Entrar»", () => {
    const button = submitButton(loginHtml, "Entrar");
    expect(attributeOf(button ?? "", "type")).toBe("submit");
  });

  it("enlaza «¿Olvidaste tu contraseña?» a /recuperar y «Crear cuenta» a /registro", () => {
    expect(linkTexts(loginHtml, "/recuperar")).toContain("¿Olvidaste tu contraseña?");
    expect(linkTexts(loginHtml, "/registro")).toContain("Crear cuenta");
  });

  it("no muestra ningún error ni el aviso de demasiados intentos al inicio", () => {
    expectNoMessages(loginHtml);
    expect(loginHtml).not.toContain("Credenciales inválidas");
    expect(loginHtml).not.toContain("Demasiados intentos");
  });
});

describe("Páginas /registro y /recuperar (reglas 6, 9 y 18)", () => {
  const cases = [
    { name: "/registro", page: RegistroPage, title: "Crear cuenta" },
    { name: "/recuperar", page: RecuperarPage, title: "Recuperar contraseña" },
  ];

  for (const { name, page, title } of cases) {
    it(`${name} tiene un único <h1> «${title}»`, () => {
      const html = renderToStaticMarkup(createElement(page));
      const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
      expect(headings).toHaveLength(1);
      expect(textOf(headings[0] ?? "")).toBe(title);
    });

    it(`${name} se pinta entera, con su formulario y sin mensajes`, () => {
      const html = renderToStaticMarkup(createElement(page));
      expect(html).toContain("<form");
      expectNoMessages(html);
    });
  }

  it("el título de /registro está enlazado como nombre accesible del formulario", () => {
    const html = renderToStaticMarkup(createElement(RegistroPage));
    const form = openingTags(html, "form")[0];
    const labelledBy = attributeOf(form, "aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(tagById(html, labelledBy ?? "")).not.toBeNull();
  });
});

describe("Pantallas públicas · no leen la sesión (regla 18)", () => {
  const files = [
    "../../../registro/page.tsx",
    "../../../recuperar/page.tsx",
    "../ui/register-form.tsx",
    "../ui/forgot-password-form.tsx",
  ];
  for (const relative of files) {
    it(`${relative.replace("../", "")} no usa getSessionUser, readNavUser, cookies ni headers`, () => {
      const code = readFileSync(resolve(import.meta.dirname, relative), "utf8");
      expect(code).not.toMatch(/\b(getSessionUser|readNavUser)\b/);
      expect(code).not.toMatch(/\b(cookies|headers)\s*\(/);
    });
  }
});
