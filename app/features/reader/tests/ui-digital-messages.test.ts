import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attributeOf, linkTexts, openingTags, textOf } from "@/tests/helpers/html";
import {
  DigitalMessage,
  IDLE_OUTCOME,
  errorDescribedBy,
  joinDescribedBy,
  type DigitalOutcome,
} from "../ui/digital-message";
import { DIGITAL_SESSION_ENDED_ERROR } from "../ui/digital-state";

function render(outcome: DigitalOutcome, id = "mensaje"): string {
  return renderToStaticMarkup(createElement(DigitalMessage, { outcome, id }));
}

describe("F27 · UI · DigitalMessage (regla 14)", () => {
  it("sin resultado no pinta nada", () => {
    expect(render(IDLE_OUTCOME)).toBe("");
  });

  it('el éxito va en un <p role="status"> con el id dado y el texto', () => {
    const html = render({ kind: "done", text: "Se guardaron 5 copias digitales de «Rayuela»." }, "ok-1");

    const tag = openingTags(html, "p")[0];
    expect(attributeOf(tag, "role")).toBe("status");
    expect(attributeOf(tag, "id")).toBe("ok-1");
    expect(textOf(html)).toBe("Se guardaron 5 copias digitales de «Rayuela».");
    expect(html).not.toContain('role="alert"');
  });

  it('el error va en un <p role="alert"> con el id dado y el texto', () => {
    const html = render({ kind: "error", message: "El archivo está vacío." }, "err-1");

    const tag = openingTags(html, "p")[0];
    expect(attributeOf(tag, "role")).toBe("alert");
    expect(attributeOf(tag, "id")).toBe("err-1");
    expect(textOf(html)).toBe("El archivo está vacío.");
    expect(html).not.toContain('role="status"');
  });

  it("un mensaje del servidor (409) se muestra completo y sin enlaces", () => {
    const text = "Otra persona acaba de cargar un contenido para este libro. Inténtalo de nuevo.";

    const html = render({ kind: "error", message: text });

    expect(textOf(html)).toBe(text);
    expect(html).not.toContain("<a");
  });

  it("con la sesión terminada el texto es el de la spec y «Vuelve a ingresar» enlaza a /login", () => {
    const html = render({ kind: "error", message: DIGITAL_SESSION_ENDED_ERROR });

    expect(textOf(html)).toBe("Tu sesión terminó. Vuelve a ingresar.");
    expect(linkTexts(html, "/login")).toEqual(["Vuelve a ingresar"]);
    expect(openingTags(html, "p")[0]).toContain('role="alert"');
  });

  it("el texto del servidor se escapa (no se interpreta como HTML)", () => {
    const html = render({ kind: "error", message: "<img src=x onerror=alert(1)>" });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("ningún mensaje usa <div> ni <span>", () => {
    expect(render({ kind: "done", text: "Hecho" })).not.toMatch(/<(div|span)\b/);
    expect(render({ kind: "error", message: "Mal" })).not.toMatch(/<(div|span)\b/);
  });
});

describe("F27 · UI · aria-describedby de los formularios", () => {
  it("errorDescribedBy devuelve el id solo cuando hay error", () => {
    expect(errorDescribedBy({ kind: "error", message: "Mal" }, "msg")).toBe("msg");
    expect(errorDescribedBy({ kind: "done", text: "Bien" }, "msg")).toBeUndefined();
    expect(errorDescribedBy(IDLE_OUTCOME, "msg")).toBeUndefined();
  });

  it("joinDescribedBy une los ids presentes con un espacio", () => {
    expect(joinDescribedBy(["ayuda", "archivo", "error"])).toBe("ayuda archivo error");
  });

  it("joinDescribedBy omite los ausentes", () => {
    expect(joinDescribedBy(["ayuda", undefined, "error"])).toBe("ayuda error");
    expect(joinDescribedBy([undefined, "ayuda"])).toBe("ayuda");
  });

  it("joinDescribedBy devuelve undefined si no queda ninguno", () => {
    expect(joinDescribedBy([])).toBeUndefined();
    expect(joinDescribedBy([undefined, undefined])).toBeUndefined();
  });
});
