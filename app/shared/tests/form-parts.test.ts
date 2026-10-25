import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ButtonLink } from "@/shared/ui/button-link";
import { TextField } from "@/shared/ui/text-field";
import { attributeOf, fieldLabelled, hasAttribute, openingTags, tagById, textOf } from "@/tests/helpers/html";
import { textOwners } from "@/tests/helpers/html-text";

function field(over: { hint?: string; error?: string; inputMode?: "numeric"; defaultValue?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(TextField, {
      id: "campo",
      name: "campo",
      label: "Etiqueta",
      type: "text",
      autoComplete: "off",
      ...over,
    }),
  );
}

describe("F36 · TextField (reglas 2 y 4)", () => {
  it("sin ayuda ni error: etiqueta enlazada, obligatorio y sin aria-describedby", () => {
    const html = field();
    const input = fieldLabelled(html, "Etiqueta") ?? "";
    expect(attributeOf(input, "id")).toBe("campo");
    expect(hasAttribute(input, "required")).toBe(true);
    expect(attributeOf(input, "aria-describedby")).toBeNull();
    expect(attributeOf(input, "aria-invalid")).toBe("false");
    expect(html).not.toContain('role="alert"');
    expect(attributeOf(input, "class")).toContain("min-h-11");
  });

  it("con ayuda: el texto se ve y el campo la enlaza", () => {
    const html = field({ hint: "10 o 13 dígitos" });
    const input = fieldLabelled(html, "Etiqueta") ?? "";
    expect(attributeOf(input, "aria-describedby")).toBe("campo-ayuda");
    expect(tagById(html, "campo-ayuda")).not.toBeNull();
    expect(html).toMatch(/id="campo-ayuda"[^>]*>\s*10 o 13 dígitos\s*<\/p>/);
  });

  it("con error: va en role=alert, el campo queda inválido y lo enlaza", () => {
    const html = field({ error: "Escribe el título." });
    const input = fieldLabelled(html, "Etiqueta") ?? "";
    expect(attributeOf(input, "aria-invalid")).toBe("true");
    expect(attributeOf(input, "aria-describedby")).toBe("campo-error");
    expect(html).toMatch(/<p\b[^>]*id="campo-error"[^>]*role="alert"[^>]*>\s*Escribe el título\.\s*<\/p>/);
  });

  it("con ayuda y error: el campo enlaza ambos", () => {
    const html = field({ hint: "Ayuda", error: "Error" });
    const input = fieldLabelled(html, "Etiqueta") ?? "";
    expect(attributeOf(input, "aria-describedby")).toBe("campo-ayuda campo-error");
  });

  it("pasa inputmode y valor inicial al campo", () => {
    const input = fieldLabelled(field({ inputMode: "numeric", defaultValue: "1" }), "Etiqueta") ?? "";
    expect(attributeOf(input, "inputmode")).toBe("numeric");
    expect(attributeOf(input, "value")).toBe("1");
  });

  it("el error y la ayuda salen escapados", () => {
    const html = field({ error: "<img src=x>" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("ningún <div> ni <span> lleva texto", () => {
    const html = field({ hint: "Ayuda", error: "Error" });
    expect(textOwners(html).filter((owner) => owner.tag === "div" || owner.tag === "span")).toEqual([]);
  });
});

describe("F36 · ButtonLink (regla 12)", () => {
  const html = renderToStaticMarkup(ButtonLink({ href: "/cuentas/nuevo", children: "Nueva cuenta" }));

  it("es un único enlace al destino con el texto dado", () => {
    expect(openingTags(html, "a")).toHaveLength(1);
    expect(attributeOf(openingTags(html, "a")[0], "href")).toBe("/cuentas/nuevo");
    expect(textOf(html)).toBe("Nueva cuenta");
  });

  it("mide al menos 44 px de alto y de ancho", () => {
    const klass = attributeOf(openingTags(html, "a")[0], "class") ?? "";
    expect(klass).toContain("min-h-11");
    expect(klass).toContain("min-w-11");
  });

  it("usa colores de la paleta (tokens), no colores sueltos", () => {
    const klass = attributeOf(openingTags(html, "a")[0], "class") ?? "";
    expect(klass).toContain("bg-primary");
    expect(klass).not.toMatch(/#[0-9a-f]{3,6}|\b(?:bg|text)-(?:red|blue|green|gray|slate|white|black)\b/i);
  });
});
