import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById } from "@/tests/helpers/html";
import { buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { CreateStaffInputSchema } from "../schema";
import { createdMessage, STAFF_DEFAULT_ERROR, STAFF_INVALID_DATA_ERROR, StaffForm } from "../ui/staff-form";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const html = renderToStaticMarkup(createElement(StaffForm));

describe("F13 · textos del formulario «Crear bibliotecario» (regla 13)", () => {
  it("el aviso de éxito es «Se creó la cuenta de {Nombre}.»", () => {
    expect(createdMessage("Luis Gómez")).toBe("Se creó la cuenta de Luis Gómez.");
  });

  it("el aviso de éxito no interpreta el nombre (React lo escapa al pintarlo)", () => {
    expect(createdMessage("<b>Luis</b>")).toBe("Se creó la cuenta de <b>Luis</b>.");
  });

  it("el error de respaldo (red o cuerpo ilegible) es «No se pudo crear la cuenta»", () => {
    expect(STAFF_DEFAULT_ERROR).toBe("No se pudo crear la cuenta");
  });

  it("el error de datos inválidos es un texto en español", () => {
    expect(STAFF_INVALID_DATA_ERROR).toBe("Revisa los datos del formulario.");
  });
});

describe("F13 · StaffForm · estado inicial (regla 13)", () => {
  it("es un formulario <form> con nombre accesible", () => {
    const form = openingTags(html, "form")[0];
    expect(form).toBeDefined();
    expect(attributeOf(form, "aria-labelledby")).toBe("personal-crear-titulo");
  });

  it("tiene tres campos con etiqueta: Nombre, Correo y Contraseña", () => {
    expect(openingTags(html, "input")).toHaveLength(3);
    expect(fieldLabelled(html, "Nombre")).not.toBeNull();
    expect(fieldLabelled(html, "Correo")).not.toBeNull();
    expect(fieldLabelled(html, "Contraseña")).not.toBeNull();
  });

  it("los campos son de los tipos correctos y obligatorios", () => {
    const name = fieldLabelled(html, "Nombre") ?? "";
    const email = fieldLabelled(html, "Correo") ?? "";
    const password = fieldLabelled(html, "Contraseña") ?? "";
    expect(attributeOf(name, "type")).toBe("text");
    expect(attributeOf(email, "type")).toBe("email");
    expect(attributeOf(password, "type")).toBe("password");
    for (const field of [name, email, password]) {
      expect(hasAttribute(field, "required")).toBe(true);
    }
  });

  it("autocomplete: name, email y new-password (el administrador no es quien ingresa)", () => {
    expect(attributeOf(fieldLabelled(html, "Nombre") ?? "", "autocomplete")).toBe("name");
    expect(attributeOf(fieldLabelled(html, "Correo") ?? "", "autocomplete")).toBe("email");
    expect(attributeOf(fieldLabelled(html, "Contraseña") ?? "", "autocomplete")).toBe("new-password");
  });

  it("los nombres de los campos son los del contrato: name, email y password", () => {
    expect(attributeOf(fieldLabelled(html, "Nombre") ?? "", "name")).toBe("name");
    expect(attributeOf(fieldLabelled(html, "Correo") ?? "", "name")).toBe("email");
    expect(attributeOf(fieldLabelled(html, "Contraseña") ?? "", "name")).toBe("password");
    expect(Object.keys(CreateStaffInputSchema.shape).sort()).toEqual(["email", "name", "password"]);
  });

  it("no ofrece elegir el rol: la cuenta siempre nace como bibliotecario", () => {
    expect(html).not.toMatch(/name="role"/);
    expect(html).not.toMatch(/<select\b/);
    expect(html).not.toMatch(/type="hidden"/);
  });

  it("la contraseña muestra la ayuda «Entre 8 y 100 caracteres» enlazada con aria-describedby", () => {
    const password = fieldLabelled(html, "Contraseña") ?? "";
    const hintId = attributeOf(password, "aria-describedby") ?? "";
    expect(hintId).not.toBe("");
    expect(tagById(html, hintId)).not.toBeNull();
    expect(html).toMatch(new RegExp(`id="${hintId}"[^>]*>\\s*Entre 8 y 100 caracteres\\s*</p>`));
  });

  it("los límites del navegador coinciden con el contrato: contraseña 8 a 100 y nombre hasta 120", () => {
    const password = fieldLabelled(html, "Contraseña") ?? "";
    const name = fieldLabelled(html, "Nombre") ?? "";
    expect(attributeOf(password, "minlength")).toBe("8");
    expect(attributeOf(password, "maxlength")).toBe("100");
    expect(attributeOf(name, "maxlength")).toBe("120");
  });

  it("el botón «Crear bibliotecario» es de envío, está habilitado y mide al menos 44 px", () => {
    const button = buttonLabelled(html, "Crear bibliotecario") ?? "";
    expect(button).not.toBe("");
    expect(attributeOf(button, "type")).toBe("submit");
    expect(hasAttribute(button, "disabled")).toBe(false);
    expect(attributeOf(button, "class")).toContain("min-h-11");
  });

  it("al empezar no hay mensajes de éxito ni de error", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Se creó la cuenta");
    expect(html).not.toContain(STAFF_DEFAULT_ERROR);
    expect(attributeOf(openingTags(html, "form")[0], "aria-describedby")).toBeNull();
  });

  it("ningún <div> ni <span> lleva texto (solo estructura)", () => {
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
    expect(owners.length).toBeGreaterThan(0);
  });
});

describe("F13 · coherencia del formulario con el contrato", () => {
  it("una contraseña de 8 caracteres y otra de 100 las acepta el contrato; de 7 y de 101, no", () => {
    const base = { name: "Luis Gómez", email: "luis@example.com" };
    expect(CreateStaffInputSchema.safeParse({ ...base, password: "a".repeat(7) }).success).toBe(false);
    expect(CreateStaffInputSchema.safeParse({ ...base, password: "a".repeat(8) }).success).toBe(true);
    expect(CreateStaffInputSchema.safeParse({ ...base, password: "a".repeat(100) }).success).toBe(true);
    expect(CreateStaffInputSchema.safeParse({ ...base, password: "a".repeat(101) }).success).toBe(false);
  });
});
