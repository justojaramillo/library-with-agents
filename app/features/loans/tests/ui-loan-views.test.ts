import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActiveLoansList } from "@/features/loans/ui/active-loans-list";
import { LoanCard } from "@/features/loans/ui/loan-card";
import type { LoanRow } from "@/features/loans/ui/loan-rows";
import { aLoanRow } from "@/tests/helpers/loan-rows";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderCard(row: LoanRow): string {
  return renderToStaticMarkup(createElement(LoanCard, { row }));
}

function renderList(rows: LoanRow[]): string {
  return renderToStaticMarkup(createElement(ActiveLoansList, { rows }));
}

function countOf(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

const OVERDUE_3_DAYS = { days_late: 3, fine_cop: 1_500 } as const;

describe("F35 · LoanCard (tarjeta de solo lectura)", () => {
  it("es un <article> con el título, el autor, el préstamo y el vencimiento en hora de Bogotá", () => {
    const html = renderCard(aLoanRow({ book_title: "Dune", book_author: "Frank Herbert" }));
    expect(html).toMatch(/<article/);
    expect(html).toContain("Dune");
    expect(html).toContain("Frank Herbert");
    expect(html).toContain("30 de enero de 2026, 3:45 p. m.");
  });

  it("las fechas son elementos <time> con el instante ISO en `datetime`", () => {
    const html = renderCard(aLoanRow({ loaned_at: "2026-01-10T15:00:00.000Z", due_at: "2026-01-30T20:45:00.000Z" }));
    expect(html).toContain('<time dateTime="2026-01-30T20:45:00.000Z">');
    expect(html).toContain('<time dateTime="2026-01-10T15:00:00.000Z">');
  });

  describe("en plazo", () => {
    const html = renderCard(aLoanRow({ days_late: 0, fine_cop: 0 }));

    it("dice «En plazo»", () => {
      expect(html).toContain("En plazo");
    });

    it("no habla de vencimiento ni de multa", () => {
      expect(html).not.toContain("Vencido");
      expect(html).not.toContain("Multa");
    });

    it("acompaña el estado con un icono decorativo, no solo con color", () => {
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    });
  });

  describe("vencido hace 3 días", () => {
    const html = renderCard(aLoanRow(OVERDUE_3_DAYS));

    it("dice «Vencido hace 3 días» y «Multa acumulada: $1.500 COP»", () => {
      expect(html).toContain("Vencido hace 3 días");
      expect(html).toContain("Multa acumulada: $1.500 COP");
    });

    it("no dice «En plazo»", () => {
      expect(html).not.toContain("En plazo");
    });

    it("tiene icono decorativo además del texto", () => {
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    });
  });

  it("vencido hace 1 día lo dice en singular", () => {
    const html = renderCard(aLoanRow({ days_late: 1, fine_cop: 500 }));
    expect(html).toContain("Vencido hace 1 día");
    expect(html).not.toContain("1 días");
    expect(html).toContain("Multa acumulada: $500 COP");
  });

  it("con la multa en el tope muestra «$20.000 COP»", () => {
    const html = renderCard(aLoanRow({ days_late: 40, fine_cop: 20_000 }));
    expect(html).toContain("Vencido hace 40 días");
    expect(html).toContain("Multa acumulada: $20.000 COP");
  });

  it("no tiene botones de acción (renovar es F24)", () => {
    expect(renderCard(aLoanRow())).not.toContain("<button");
    expect(renderCard(aLoanRow(OVERDUE_3_DAYS))).not.toContain("<button");
  });

  it("no muestra a la persona del préstamo: es la vista propia del prestatario", () => {
    const html = renderCard(aLoanRow({ member_name: "Nombre Ajeno Único", member_role: "DOCENTE" }));
    expect(html).not.toContain("Nombre Ajeno Único");
  });

  it("escapa un título con marcado", () => {
    const html = renderCard(aLoanRow({ book_title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("un título de 200 caracteres se muestra completo", () => {
    const title = "T".repeat(200);
    expect(renderCard(aLoanRow({ book_title: title }))).toContain(title);
  });

  it("no lleva un <h1>: el título de la página lo pone la página", () => {
    expect(renderCard(aLoanRow())).not.toContain("<h1");
  });
});

describe("F34 · ActiveLoansList (préstamos activos del personal)", () => {
  it("sin préstamos dice «No hay préstamos activos.» y no pinta tarjetas", () => {
    const html = renderList([]);
    expect(html).toContain("No hay préstamos activos.");
    expect(html).not.toContain("<article");
    expect(html).not.toContain("Devolver");
  });

  it("con préstamos no dice «No hay préstamos activos.»", () => {
    expect(renderList([aLoanRow()])).not.toContain("No hay préstamos activos.");
  });

  it("pinta un <article> por préstamo dentro de una lista", () => {
    const html = renderList([aLoanRow(), aLoanRow(), aLoanRow()]);
    expect(countOf(html, /<article/g)).toBe(3);
    expect(html).toMatch(/<ul[^>]*>[^]*<li[^>]*>[^]*<article/);
  });

  it("conserva el orden recibido (el servicio ya los entrega por vencimiento)", () => {
    const html = renderList([
      aLoanRow({ book_title: "Primero" }),
      aLoanRow({ book_title: "Segundo" }),
      aLoanRow({ book_title: "Tercero" }),
    ]);
    expect(html.indexOf("Primero")).toBeLessThan(html.indexOf("Segundo"));
    expect(html.indexOf("Segundo")).toBeLessThan(html.indexOf("Tercero"));
  });

  it("cada tarjeta muestra título, autor, persona con su rol en español y las fechas", () => {
    const html = renderList([
      aLoanRow({
        book_title: "Dune",
        book_author: "Frank Herbert",
        member_name: "Ana Pérez",
        member_role: "DOCENTE",
      }),
    ]);
    expect(html).toContain("Dune");
    expect(html).toContain("Frank Herbert");
    expect(html).toContain("Ana Pérez");
    expect(html).toContain("Docente");
    expect(html).toContain('<time dateTime="2026-01-10T15:00:00.000Z">10 de enero de 2026</time>');
    expect(html).toContain("30 de enero de 2026, 3:45 p. m.");
  });

  it("cada tarjeta tiene su botón «Devolver» (y todavía ningún «Confirmar»)", () => {
    const html = renderList([aLoanRow(), aLoanRow()]);
    expect(countOf(html, />Devolver</g)).toBe(2);
    expect(html).not.toContain("Confirmar");
    expect(html).not.toContain("Cancelar");
  });

  describe("estado", () => {
    it("en plazo: texto «En plazo» con icono", () => {
      const html = renderList([aLoanRow({ days_late: 0 })]);
      expect(html).toContain("En plazo");
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(html).not.toContain("Multa");
    });

    it("vencido con multa: «Vencido hace 3 días» y «Multa acumulada: $1.500 COP», con icono", () => {
      const html = renderList([aLoanRow(OVERDUE_3_DAYS)]);
      expect(html).toContain("Vencido hace 3 días");
      expect(html).toContain("Multa acumulada: $1.500 COP");
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(html).not.toContain("En plazo");
    });

    it("vencido hace 1 día en singular", () => {
      const html = renderList([aLoanRow({ days_late: 1, fine_cop: 500 })]);
      expect(html).toContain("Vencido hace 1 día");
      expect(html).not.toContain("1 días");
    });

    it("multa en el tope: «$20.000 COP»", () => {
      expect(renderList([aLoanRow({ days_late: 99, fine_cop: 20_000 })])).toContain("$20.000 COP");
    });

    it("mezcla de estados: una tarjeta en plazo y otra vencida", () => {
      const html = renderList([aLoanRow({ days_late: 0 }), aLoanRow(OVERDUE_3_DAYS)]);
      expect(countOf(html, /En plazo/g)).toBe(1);
      expect(countOf(html, /Vencido hace/g)).toBe(1);
    });
  });

  describe("libro o cuenta borrados (regla 9)", () => {
    it("la tarjeta con «Libro no disponible» y «Cuenta no disponible» sigue permitiendo devolver", () => {
      const html = renderList([
        aLoanRow({
          book_title: "Libro no disponible (b-9)",
          member_name: "Cuenta no disponible (m-9)",
          member_role: null,
        }),
      ]);
      expect(html).toContain("Libro no disponible (b-9)");
      expect(html).toContain("Cuenta no disponible (m-9)");
      expect(html).toContain(">Devolver<");
    });
  });

  it("escapa nombres y títulos con marcado", () => {
    const html = renderList([aLoanRow({ book_title: "<img src=x onerror=alert(1)>", member_name: "<b>Yo</b>" })]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Yo</b>");
  });

  it("un nombre y un título de 200 caracteres se muestran completos", () => {
    const long = "N".repeat(200);
    const html = renderList([aLoanRow({ book_title: long, member_name: long })]);
    expect(countOf(html, /N{200}/g)).toBeGreaterThanOrEqual(2);
  });

  it("no pinta un <h1>: el título «Préstamos» lo pone la página", () => {
    expect(renderList([aLoanRow()])).not.toContain("<h1");
    expect(renderList([])).not.toContain("<h1");
  });
});
