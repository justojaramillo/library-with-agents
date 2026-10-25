import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "@/features/catalog/schema";
import type { Member } from "@/features/accounts/schema";
import { BookPicker } from "@/features/loans/ui/book-picker";
import { LendForm } from "@/features/loans/ui/lend-form";
import { LocalDate } from "@/features/loans/ui/local-date";
import { MemberPicker } from "@/features/loans/ui/member-picker";
import { ReturnButton } from "@/features/loans/ui/return-button";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const NO_OP = () => undefined;

const ANA: Member = {
  id: "m1",
  name: "Ana Pérez",
  email: "ana@example.com",
  role: "ESTUDIANTE",
  active: true,
};
const DUNE: Book = {
  id: "b1",
  isbn: "9780441172719",
  title: "Dune",
  author: "Frank Herbert",
  copies: 2,
  available: 1,
};

function renderForm(): string {
  return renderToStaticMarkup(createElement(LendForm));
}

function renderMemberPicker(selected: Member | null): string {
  return renderToStaticMarkup(createElement(MemberPicker, { selected, onSelect: NO_OP, onClear: NO_OP }));
}

function renderBookPicker(selected: Book | null): string {
  return renderToStaticMarkup(createElement(BookPicker, { selected, onSelect: NO_OP, onClear: NO_OP }));
}

/** Atributos de la etiqueta `<button>` cuyo texto es exactamente `text`. */
function buttonAttributes(html: string, text: string): string | undefined {
  const match = new RegExp(`<button([^>]*)>\\s*${text}\\s*</button>`).exec(html);
  return match?.[1];
}

/** `id` del campo al que apunta la etiqueta con ese texto (`<label for=…>`). */
function inputIdOfLabel(html: string, text: string): string | undefined {
  const match = new RegExp(`<label[^>]*for="([^"]+)"[^>]*>\\s*${text}\\s*</label>`).exec(html);
  return match?.[1];
}

describe("F34 · LendForm (render inicial)", () => {
  const html = renderForm();

  it("es un formulario", () => {
    expect(html).toMatch(/<form/);
  });

  it("tiene los dos campos con sus etiquetas", () => {
    expect(html).toContain("Buscar persona (nombre o correo)");
    expect(html).toContain("Buscar libro (título o autor)");
  });

  it("cada etiqueta está enlazada a un campo de texto real", () => {
    for (const label of ["Buscar persona \\(nombre o correo\\)", "Buscar libro \\(título o autor\\)"]) {
      const id = inputIdOfLabel(html, label);
      expect(id).toBeDefined();
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*type="text"|<input[^>]*type="text"[^>]*id="${id}"`));
    }
  });

  it("los dos campos tienen su botón «Buscar»", () => {
    expect(html.match(/>Buscar</g)).toHaveLength(2);
  });

  it("el botón «Prestar» existe y está deshabilitado hasta tener ambas elecciones", () => {
    const attributes = buttonAttributes(html, "Prestar");
    expect(attributes).toBeDefined();
    expect(attributes).toContain("disabled");
    expect(attributes).toContain('type="submit"');
  });

  it("los botones «Buscar» no envían el formulario de prestar (son type=button)", () => {
    const attributes = buttonAttributes(html, "Buscar");
    expect(attributes).toContain('type="button"');
    expect(attributes).not.toContain('type="submit"');
  });

  it("todavía no hay elecciones, sugerencias ni mensajes", () => {
    expect(html).not.toContain("seleccionada");
    expect(html).not.toContain("Cambiar");
    expect(html).not.toContain("Buscando");
    expect(html).not.toContain("Escribe al menos 2 letras.");
    expect(html).not.toContain("No hay coincidencias.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("anuncia los resultados de la búsqueda en una región aria-live educada", () => {
    expect(html).toContain('aria-live="polite"');
  });
});

describe("F34 · MemberPicker", () => {
  it("sin elección muestra el campo «Buscar persona (nombre o correo)» y el botón «Buscar»", () => {
    const html = renderMemberPicker(null);
    expect(html).toContain("Buscar persona (nombre o correo)");
    expect(html).toContain(">Buscar<");
    expect(html).not.toContain("Cambiar");
  });

  it("con una elección muestra «Persona seleccionada: Nombre — correo» y «Cambiar»", () => {
    const html = renderMemberPicker(ANA);
    expect(html).toMatch(/Persona seleccionada:[^]*Ana Pérez — ana@example\.com/);
    expect(html).toContain(">Cambiar<");
  });

  it("con una elección el campo de búsqueda desaparece", () => {
    const html = renderMemberPicker(ANA);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Buscar persona (nombre o correo)");
  });

  it("«Cambiar» es un botón que no envía el formulario", () => {
    expect(buttonAttributes(renderMemberPicker(ANA), "Cambiar")).toContain('type="button"');
  });

  it("escapa un nombre con marcado", () => {
    const html = renderMemberPicker({ ...ANA, name: "<script>x</script>" });
    expect(html).not.toContain("<script>");
  });
});

describe("F34 · BookPicker", () => {
  it("sin elección muestra el campo «Buscar libro (título o autor)» y el botón «Buscar»", () => {
    const html = renderBookPicker(null);
    expect(html).toContain("Buscar libro (título o autor)");
    expect(html).toContain(">Buscar<");
    expect(html).not.toContain("Cambiar");
  });

  it("con una elección muestra el título, el autor y «Cambiar»", () => {
    const html = renderBookPicker(DUNE);
    expect(html).toContain("Dune");
    expect(html).toContain("Frank Herbert");
    expect(html).toContain(">Cambiar<");
    expect(html).not.toContain("<input");
  });
});

describe("F34 · ReturnButton (render inicial)", () => {
  const html = renderToStaticMarkup(createElement(ReturnButton, { loanId: "loan-1", bookTitle: "Dune" }));

  it("muestra el botón «Devolver»", () => {
    expect(html).toContain(">Devolver<");
  });

  it("todavía no muestra «Confirmar devolución» ni «Cancelar»", () => {
    expect(html).not.toContain("Confirmar devolución");
    expect(html).not.toContain("Cancelar");
  });

  it("es un botón que no envía ningún formulario y no está deshabilitado", () => {
    const attributes = buttonAttributes(html, "Devolver");
    expect(attributes).toContain('type="button"');
    expect(attributes).not.toContain("disabled");
  });

  it("su nombre accesible nombra el libro", () => {
    expect(html).toContain("Dune");
  });

  it("escapa un título con marcado", () => {
    const hostile = renderToStaticMarkup(
      createElement(ReturnButton, { loanId: "l", bookTitle: '"><img src=x onerror=alert(1)>' }),
    );
    expect(hostile).not.toContain("<img");
  });
});

describe("F34–F35 · LocalDate (HTML inicial en America/Bogota)", () => {
  it("renderiza <time datetime> con el instante ISO y la fecha en Bogotá", () => {
    const html = renderToStaticMarkup(createElement(LocalDate, { iso: "2026-01-30T20:45:00.000Z" }));
    expect(html).toBe('<time dateTime="2026-01-30T20:45:00.000Z">30 de enero de 2026</time>');
  });

  it("con hora muestra «30 de enero de 2026, 3:45 p. m.»", () => {
    const html = renderToStaticMarkup(createElement(LocalDate, { iso: "2026-01-30T20:45:00.000Z", withTime: true }));
    expect(html).toBe('<time dateTime="2026-01-30T20:45:00.000Z">30 de enero de 2026, 3:45 p. m.</time>');
  });

  it("cerca de la medianoche UTC la fecha de Bogotá es la del día anterior", () => {
    const html = renderToStaticMarkup(createElement(LocalDate, { iso: "2026-01-31T03:30:00.000Z" }));
    expect(html).toContain('dateTime="2026-01-31T03:30:00.000Z"');
    expect(html).toContain("30 de enero de 2026");
  });
});
