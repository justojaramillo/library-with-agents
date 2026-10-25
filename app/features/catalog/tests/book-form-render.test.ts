import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { CreateBookInputSchema } from "../schema";
import { BookForm } from "../ui/book-form";

const html = renderToStaticMarkup(createElement(BookForm));

describe("F36 · BookForm · estado inicial (reglas 2 y 4)", () => {
  it("es un formulario sin validación del navegador y con nombre accesible «Registrar libro»", () => {
    const form = openingTags(html, "form")[0];
    expect(form).toBeDefined();
    expect(hasAttribute(form, "novalidate")).toBe(true);
    expect(attributeOf(form, "aria-label")).toBe("Registrar libro");
  });

  it("tiene cuatro campos con etiqueta: ISBN, Título, Autor y Ejemplares", () => {
    expect(openingTags(html, "input")).toHaveLength(4);
    for (const label of ["ISBN", "Título", "Autor", "Ejemplares"]) {
      expect(fieldLabelled(html, label), label).not.toBeNull();
    }
  });

  it("los nombres de los campos son los del contrato", () => {
    expect(attributeOf(fieldLabelled(html, "ISBN") ?? "", "name")).toBe("isbn");
    expect(attributeOf(fieldLabelled(html, "Título") ?? "", "name")).toBe("title");
    expect(attributeOf(fieldLabelled(html, "Autor") ?? "", "name")).toBe("author");
    expect(attributeOf(fieldLabelled(html, "Ejemplares") ?? "", "name")).toBe("copies");
    expect(Object.keys(CreateBookInputSchema.shape).sort()).toEqual(["author", "copies", "isbn", "title"]);
  });

  it("los ids de los campos son estables", () => {
    expect(attributeOf(fieldLabelled(html, "ISBN") ?? "", "id")).toBe("libro-isbn");
    expect(attributeOf(fieldLabelled(html, "Título") ?? "", "id")).toBe("libro-title");
    expect(attributeOf(fieldLabelled(html, "Autor") ?? "", "id")).toBe("libro-autor");
    expect(attributeOf(fieldLabelled(html, "Ejemplares") ?? "", "id")).toBe("libro-ejemplares");
  });

  it("todos los campos son de texto y obligatorios", () => {
    for (const label of ["ISBN", "Título", "Autor", "Ejemplares"]) {
      const field = fieldLabelled(html, label) ?? "";
      expect(attributeOf(field, "type"), label).toBe("text");
      expect(hasAttribute(field, "required"), label).toBe(true);
    }
  });

  it("autocomplete es off en el ISBN (y en el resto de campos del libro)", () => {
    expect(attributeOf(fieldLabelled(html, "ISBN") ?? "", "autocomplete")).toBe("off");
    expect(attributeOf(fieldLabelled(html, "Título") ?? "", "autocomplete")).toBe("off");
    expect(attributeOf(fieldLabelled(html, "Autor") ?? "", "autocomplete")).toBe("off");
  });

  it("inputmode numérico solo en el ISBN y en los ejemplares", () => {
    expect(attributeOf(fieldLabelled(html, "ISBN") ?? "", "inputmode")).toBe("numeric");
    expect(attributeOf(fieldLabelled(html, "Ejemplares") ?? "", "inputmode")).toBe("numeric");
    expect(attributeOf(fieldLabelled(html, "Título") ?? "", "inputmode")).toBeNull();
    expect(attributeOf(fieldLabelled(html, "Autor") ?? "", "inputmode")).toBeNull();
  });

  it("los ejemplares empiezan en 1 y el resto de campos, vacíos", () => {
    expect(attributeOf(fieldLabelled(html, "Ejemplares") ?? "", "value")).toBe("1");
    for (const label of ["ISBN", "Título", "Autor"]) {
      const value = attributeOf(fieldLabelled(html, label) ?? "", "value");
      expect(value === null || value === "", label).toBe(true);
    }
  });

  it("el ISBN muestra la ayuda «10 o 13 dígitos» enlazada con aria-describedby", () => {
    const isbn = fieldLabelled(html, "ISBN") ?? "";
    const hintId = attributeOf(isbn, "aria-describedby") ?? "";
    expect(hintId).not.toBe("");
    expect(tagById(html, hintId)).not.toBeNull();
    expect(html).toMatch(new RegExp(`id="${hintId}"[^>]*>\\s*10 o 13 dígitos\\s*</p>`));
  });

  it("el botón «Registrar libro» es de envío, está habilitado y mide al menos 44 px", () => {
    const button = buttonLabelled(html, "Registrar libro") ?? "";
    expect(button).not.toBe("");
    expect(attributeOf(button, "type")).toBe("submit");
    expect(hasAttribute(button, "disabled")).toBe(false);
    expect(attributeOf(button, "class")).toContain("min-h-11");
  });

  it("cada campo mide al menos 44 px", () => {
    for (const label of ["ISBN", "Título", "Autor", "Ejemplares"]) {
      expect(attributeOf(fieldLabelled(html, label) ?? "", "class"), label).toContain("min-h-11");
    }
  });

  it("al empezar no hay mensajes de éxito ni de error ni campos marcados como inválidos", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Se registró");
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

  it("las etiquetas son visibles (<label>), no solo marcadores", () => {
    const labels = (html.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? []).map(textOf);
    expect(labels).toEqual(["ISBN", "Título", "Autor", "Ejemplares"]);
  });
});
