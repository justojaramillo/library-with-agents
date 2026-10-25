import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { CreateMemberInputSchema } from "../schema";
import { MemberForm } from "../ui/member-form";

const html = renderToStaticMarkup(createElement(MemberForm));

/** Los `<input type="radio">` del formulario, en orden. */
function radios(): string[] {
  return openingTags(html, "input").filter((tag) => attributeOf(tag, "type") === "radio");
}

describe("F36 · MemberForm · estado inicial (reglas 8 y 9)", () => {
  it("es un formulario sin validación del navegador y con nombre accesible «Nueva cuenta»", () => {
    const form = openingTags(html, "form")[0];
    expect(form).toBeDefined();
    expect(hasAttribute(form, "novalidate")).toBe(true);
    expect(attributeOf(form, "aria-label")).toBe("Nueva cuenta");
  });

  it("tiene tres campos de texto con etiqueta: Nombre, Correo y Contraseña", () => {
    const textual = openingTags(html, "input").filter((tag) => attributeOf(tag, "type") !== "radio");
    expect(textual).toHaveLength(3);
    for (const label of ["Nombre", "Correo", "Contraseña"]) {
      expect(fieldLabelled(html, label), label).not.toBeNull();
    }
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

  it("los ids y nombres de los campos son los del contrato", () => {
    const name = fieldLabelled(html, "Nombre") ?? "";
    const email = fieldLabelled(html, "Correo") ?? "";
    const password = fieldLabelled(html, "Contraseña") ?? "";
    expect(attributeOf(name, "id")).toBe("cuenta-nombre");
    expect(attributeOf(email, "id")).toBe("cuenta-correo");
    expect(attributeOf(password, "id")).toBe("cuenta-contrasena");
    expect(attributeOf(name, "name")).toBe("name");
    expect(attributeOf(email, "name")).toBe("email");
    expect(attributeOf(password, "name")).toBe("password");
    expect(Object.keys(CreateMemberInputSchema.shape).sort()).toEqual(["email", "name", "password", "role"]);
  });

  it("autocomplete: off en nombre y correo, new-password en la contraseña", () => {
    expect(attributeOf(fieldLabelled(html, "Nombre") ?? "", "autocomplete")).toBe("off");
    expect(attributeOf(fieldLabelled(html, "Correo") ?? "", "autocomplete")).toBe("off");
    expect(attributeOf(fieldLabelled(html, "Contraseña") ?? "", "autocomplete")).toBe("new-password");
  });

  it("la contraseña muestra la ayuda «Entre 8 y 100 caracteres» enlazada con aria-describedby", () => {
    const password = fieldLabelled(html, "Contraseña") ?? "";
    const hintId = attributeOf(password, "aria-describedby") ?? "";
    expect(hintId).not.toBe("");
    expect(tagById(html, hintId)).not.toBeNull();
    expect(html).toMatch(new RegExp(`id="${hintId}"[^>]*>\\s*Entre 8 y 100 caracteres\\s*</p>`));
  });

  it("la contraseña llega vacía: no se rellena con ningún valor", () => {
    const value = attributeOf(fieldLabelled(html, "Contraseña") ?? "", "value");
    expect(value === null || value === "").toBe(true);
  });

  it("cada campo de texto mide al menos 44 px", () => {
    for (const label of ["Nombre", "Correo", "Contraseña"]) {
      expect(attributeOf(fieldLabelled(html, label) ?? "", "class"), label).toContain("min-h-11");
    }
  });
});

describe("F36 · MemberForm · tipo de cuenta (regla 8)", () => {
  it("es un grupo fieldset con leyenda «Tipo de cuenta»", () => {
    expect(openingTags(html, "fieldset")).toHaveLength(1);
    const legend = /<legend\b[^>]*>([\s\S]*?)<\/legend>/.exec(html);
    expect(textOf(legend?.[1] ?? "")).toBe("Tipo de cuenta");
    expect(html.indexOf("<fieldset")).toBeLessThan(html.indexOf("<legend"));
  });

  it("ofrece exactamente dos radios, con el mismo nombre «role»", () => {
    expect(radios()).toHaveLength(2);
    for (const radio of radios()) {
      expect(attributeOf(radio, "name")).toBe("role");
    }
  });

  it("los valores son EXTERNO y ESTUDIANTE, en ese orden", () => {
    expect(radios().map((radio) => attributeOf(radio, "value"))).toEqual(["EXTERNO", "ESTUDIANTE"]);
  });

  it("las etiquetas son «Externo» y «Estudiante» y cada radio queda dentro de su etiqueta", () => {
    expect(attributeOf(fieldLabelled(html, "Externo") ?? "", "value")).toBe("EXTERNO");
    expect(attributeOf(fieldLabelled(html, "Estudiante") ?? "", "value")).toBe("ESTUDIANTE");
  });

  it("«Externo» viene marcado por defecto y «Estudiante», no", () => {
    expect(hasAttribute(fieldLabelled(html, "Externo") ?? "", "checked")).toBe(true);
    expect(hasAttribute(fieldLabelled(html, "Estudiante") ?? "", "checked")).toBe(false);
  });

  it("las opciones miden al menos 44 px", () => {
    const labels = html.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? [];
    const options = labels.filter((label) => /type="radio"/.test(label));
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(attributeOf(openingTags(option, "label")[0], "class")).toContain("min-h-11");
    }
  });

  it("nunca ofrece docente ni personal: ni como opción, ni como valor, ni en un campo oculto", () => {
    expect(html).not.toMatch(/DOCENTE|BIBLIOTECARIO|ADMINISTRADOR/);
    expect(html).not.toMatch(/Docente|Bibliotecario|Administrador|Personal/);
    expect(html).not.toMatch(/<select\b/);
    expect(html).not.toMatch(/type="hidden"/);
  });
});

describe("F36 · MemberForm · envío y mensajes iniciales (regla 10)", () => {
  it("el botón «Crear cuenta» es de envío, está habilitado y mide al menos 44 px", () => {
    const button = buttonLabelled(html, "Crear cuenta") ?? "";
    expect(button).not.toBe("");
    expect(attributeOf(button, "type")).toBe("submit");
    expect(hasAttribute(button, "disabled")).toBe(false);
    expect(attributeOf(button, "class")).toContain("min-h-11");
  });

  it("al empezar no hay mensajes de éxito ni de error ni campos marcados como inválidos", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Se creó la cuenta");
    expect(html).not.toContain('aria-invalid="true"');
    expect(attributeOf(openingTags(html, "form")[0], "aria-describedby")).toBeNull();
  });

  it("no hay ningún <h1> dentro del formulario (el título es de la página)", () => {
    expect(openingTags(html, "h1")).toHaveLength(0);
  });

  it("ningún <div> ni <span> lleva texto", () => {
    const owners = textOwners(html);
    expect(owners.filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
    expect(owners.length).toBeGreaterThan(0);
  });
});
