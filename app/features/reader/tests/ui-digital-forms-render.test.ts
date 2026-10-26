import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributeOf, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { buttonLabelled, textOwners } from "@/tests/helpers/html-text";
import { ContentForm } from "../ui/digital-content-form";
import { CopiesForm } from "../ui/digital-forms";
import { DigitalPanel } from "../ui/digital-panel";
import { anInfo, anInfoWithContent } from "./ui-fixtures";

const noop = () => undefined;

function copiesHtml(copies = 0): string {
  return renderToStaticMarkup(createElement(CopiesForm, { info: anInfo({ digital_copies: copies }), onUpdated: noop }));
}

function contentHtml(withContent: boolean): string {
  let info = anInfo();
  if (withContent) {
    info = anInfoWithContent();
  }
  return renderToStaticMarkup(createElement(ContentForm, { info, onUpdated: noop }));
}

/** La etiqueta `<input>` de un formulario (hay uno solo). */
function onlyInput(html: string): string {
  const inputs = openingTags(html, "input");
  expect(inputs).toHaveLength(1);
  return inputs[0];
}

/** Ids a los que apunta `aria-describedby` y comprobación de que existen en el HTML. */
function describedIds(html: string, field: string): string[] {
  const ids = (attributeOf(field, "aria-describedby") ?? "").split(" ").filter((id) => id !== "");
  for (const id of ids) {
    expect(tagById(html, id), id).not.toBeNull();
  }
  return ids;
}

describe("F27 · UI · formulario «Copias digitales» (regla 13)", () => {
  const html = copiesHtml(0);

  it("es una sección con el <h3> «Copias digitales» que la nombra", () => {
    const heading = /<h3\b[^>]*>[\s\S]*?<\/h3>/.exec(html)?.[0] ?? "";
    expect(textOf(heading)).toBe("Copias digitales");
    expect(attributeOf(openingTags(html, "section")[0], "aria-labelledby")).toBe(attributeOf(heading, "id"));
  });

  it("es un <form> sin validación del navegador", () => {
    const forms = openingTags(html, "form");
    expect(forms).toHaveLength(1);
    expect(hasAttribute(forms[0], "novalidate")).toBe(true);
  });

  it("tiene un campo numérico de 0 a 100 enlazado a su etiqueta", () => {
    const input = onlyInput(html);
    expect(attributeOf(input, "type")).toBe("number");
    expect(attributeOf(input, "min")).toBe("0");
    expect(attributeOf(input, "max")).toBe("100");
    expect(attributeOf(input, "step")).toBe("1");
    const label = /<label\b([^>]*)>([\s\S]*?)<\/label>/.exec(html);
    expect(label).not.toBeNull();
    expect(attributeOf(`<label${label?.[1] ?? ""}>`, "for")).toBe(attributeOf(input, "id"));
    expect(textOf(label?.[2] ?? "")).toContain("Copias digitales");
    expect(textOf(label?.[2] ?? "")).toContain("0 a 100");
  });

  it.each([0, 1, 5, 100])("el campo arranca con las copias actuales (%i)", (copies) => {
    expect(attributeOf(onlyInput(copiesHtml(copies)), "value")).toBe(String(copies));
  });

  it("el campo mide al menos 44 px", () => {
    expect(attributeOf(onlyInput(html), "class")).toContain("min-h-11");
  });

  it("el botón «Guardar copias» envía el formulario, está habilitado y mide al menos 44 px", () => {
    const button = buttonLabelled(html, "Guardar copias") ?? "";
    expect(button).not.toBe("");
    expect(attributeOf(button, "type")).toBe("submit");
    expect(hasAttribute(button, "disabled")).toBe(false);
    expect(attributeOf(button, "class")).toContain("min-h-11");
  });

  it("la ayuda está enlazada con aria-describedby y el campo no está marcado como inválido al inicio", () => {
    const input = onlyInput(html);
    expect(describedIds(html, input)).toHaveLength(1);
    expect(attributeOf(input, "aria-invalid")).toBe("false");
  });

  it("sin intento previo no hay mensajes de estado ni de alerta", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("ningún <div> ni <span> lleva texto", () => {
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});

describe("F27 · UI · formulario «Contenido» (regla 13)", () => {
  const html = contentHtml(false);

  it("es una sección con el <h3> «Contenido» que la nombra", () => {
    const heading = /<h3\b[^>]*>[\s\S]*?<\/h3>/.exec(html)?.[0] ?? "";
    expect(textOf(heading)).toBe("Contenido");
    expect(attributeOf(openingTags(html, "section")[0], "aria-labelledby")).toBe(attributeOf(heading, "id"));
  });

  it("es un <form> sin validación del navegador", () => {
    const forms = openingTags(html, "form");
    expect(forms).toHaveLength(1);
    expect(hasAttribute(forms[0], "novalidate")).toBe(true);
  });

  it("el campo de archivo acepta .md, .markdown y .txt y solo esos", () => {
    const input = onlyInput(html);
    expect(attributeOf(input, "type")).toBe("file");
    const accepted = (attributeOf(input, "accept") ?? "").split(",").map((item) => item.trim());
    expect(accepted).toEqual(expect.arrayContaining([".md", ".markdown", ".txt"]));
    expect(accepted.filter((item) => item.startsWith("."))).toEqual([".md", ".markdown", ".txt"]);
    expect(accepted.join(",")).not.toMatch(/pdf|epub|doc|html/);
  });

  it("el campo de archivo tiene una etiqueta que nombra las extensiones y mide al menos 44 px", () => {
    const input = onlyInput(html);
    const label = /<label\b([^>]*)>([\s\S]*?)<\/label>/.exec(html);
    expect(attributeOf(`<label${label?.[1] ?? ""}>`, "for")).toBe(attributeOf(input, "id"));
    expect(textOf(label?.[2] ?? "")).toContain(".md");
    expect(attributeOf(input, "class")).toContain("min-h-11");
    expect(hasAttribute(input, "disabled")).toBe(false);
  });

  it("la ayuda (UTF-8, hasta 2 MB) está enlazada con aria-describedby", () => {
    const ids = describedIds(html, onlyInput(html));
    expect(ids).toHaveLength(1);
    expect(html).toContain("2 MB");
  });

  it("sin contenido previo el botón es «Subir contenido» y no hay pasos de confirmación", () => {
    expect(buttonLabelled(html, "Subir contenido")).not.toBeNull();
    expect(buttonLabelled(html, "Reemplazar contenido")).toBeNull();
    expect(buttonLabelled(html, "Confirmar reemplazo")).toBeNull();
    expect(buttonLabelled(html, "Cancelar")).toBeNull();
  });

  it("con contenido previo el primer paso es «Reemplazar contenido», sin confirmar todavía", () => {
    const replace = contentHtml(true);

    expect(buttonLabelled(replace, "Reemplazar contenido")).not.toBeNull();
    expect(buttonLabelled(replace, "Subir contenido")).toBeNull();
    expect(buttonLabelled(replace, "Confirmar reemplazo")).toBeNull();
    expect(buttonLabelled(replace, "Cancelar")).toBeNull();
  });

  it.each([
    [false, "Subir contenido"],
    [true, "Reemplazar contenido"],
  ])("el botón principal envía el formulario, está habilitado y mide 44 px (contenido: %s)", (withContent, label) => {
    const button = buttonLabelled(contentHtml(withContent), label) ?? "";

    expect(attributeOf(button, "type")).toBe("submit");
    expect(hasAttribute(button, "disabled")).toBe(false);
    expect(attributeOf(button, "class")).toContain("min-h-11");
  });

  it("sin archivo elegido no hay nombre ni tamaño, ni mensajes", () => {
    expect(html).not.toContain("Archivo elegido");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("ningún <div> ni <span> lleva texto", () => {
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
    expect(textOwners(contentHtml(true)).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});

describe("F27 · UI · panel antes de elegir libro (regla 13)", () => {
  const html = renderToStaticMarkup(createElement(DigitalPanel));

  it("muestra el buscador «Buscar libro (título o autor)» con su botón «Buscar»", () => {
    const label = /<label\b([^>]*)>([\s\S]*?)<\/label>/.exec(html);
    expect(textOf(label?.[2] ?? "")).toBe("Buscar libro (título o autor)");
    const input = tagById(html, attributeOf(`<label${label?.[1] ?? ""}>`, "for") ?? "") ?? "";
    expect(attributeOf(input, "type")).toBe("text");
    expect(attributeOf(input, "class")).toContain("min-h-11");
    const search = buttonLabelled(html, "Buscar") ?? "";
    expect(attributeOf(search, "type")).toBe("button");
    expect(attributeOf(search, "class")).toContain("min-h-11");
  });

  it("todavía no hay libro seleccionado, ni estado, ni formularios", () => {
    expect(html).not.toContain("Libro seleccionado");
    expect(html).not.toContain("Cambiar");
    expect(html).not.toContain("Copias digitales");
    expect(buttonLabelled(html, "Guardar copias")).toBeNull();
    expect(buttonLabelled(html, "Subir contenido")).toBeNull();
    expect(openingTags(html, "form")).toHaveLength(0);
  });

  it("ningún <div> ni <span> lleva texto", () => {
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});
