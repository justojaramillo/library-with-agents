import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActiveLoansList } from "@/features/loans/ui/active-loans-list";
import { LendForm } from "@/features/loans/ui/lend-form";
import { LoanCard } from "@/features/loans/ui/loan-card";
import type { LoanRow } from "@/features/loans/ui/loan-rows";
import { aLoanRow } from "@/tests/helpers/loan-rows";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function renderCard(row: LoanRow, variant: "active" | "overdue" = "active"): string {
  return renderToStaticMarkup(createElement(LoanCard, { row, variant }));
}

function renderList(rows: LoanRow[]): string {
  return renderToStaticMarkup(createElement(ActiveLoansList, { rows }));
}

/** Contenido interno de cada `<dl>…</dl>` del HTML. */
function dlBodies(html: string): string[] {
  return [...html.matchAll(/<dl[^>]*>([^]*?)<\/dl>/g)].map((match) => match[1] ?? "");
}

/** Cada par `dt`/`dd` de la lista debe ir envuelto en un `<div>` (HTML válido); devuelve los grupos `<div>…</div>`. */
function divGroups(dlBody: string): string[] {
  return [...dlBody.matchAll(/<div[^>]*>([^]*?)<\/div>/g)].map((match) => match[1] ?? "");
}

function countOf(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

const OVERDUE = { days_late: 3, fine_cop: 1_500 } as const;

describe("HTML válido de las listas de descripción de los préstamos", () => {
  describe("LoanCard", () => {
    it("no contiene <br dentro de la tarjeta", () => {
      expect(renderCard(aLoanRow())).not.toContain("<br");
      expect(renderCard(aLoanRow(OVERDUE), "overdue")).not.toContain("<br");
    });

    it("sigue teniendo una <dl> con <dt> y <dd> con los textos", () => {
      const html = renderCard(aLoanRow());

      expect(html).toMatch(/<dl[^>]*>/);
      expect(html).toContain("Prestado el:");
      expect(html).toContain("Vence el:");
      expect(countOf(html, /<dt[ >]/g)).toBe(2);
      expect(countOf(html, /<dd[ >]/g)).toBe(2);
      expect(html).toContain("10 de enero de 2026");
      expect(html).toContain("30 de enero de 2026, 3:45 p. m.");
    });

    it("la variante vencida solo muestra el vencimiento: un par dt/dd", () => {
      const html = renderCard(aLoanRow(OVERDUE), "overdue");

      expect(countOf(html, /<dt[ >]/g)).toBe(1);
      expect(countOf(html, /<dd[ >]/g)).toBe(1);
      expect(html).toContain("Vence el:");
      expect(html).not.toContain("Prestado el:");
    });

    it("cada par dt/dd va envuelto en un <div> dentro de la <dl>", () => {
      for (const html of [renderCard(aLoanRow()), renderCard(aLoanRow(OVERDUE), "overdue")]) {
        for (const body of dlBodies(html)) {
          const groups = divGroups(body);
          expect(groups.length).toBeGreaterThan(0);
          for (const group of groups) {
            expect(countOf(group, /<dt[ >]/g)).toBe(1);
            expect(countOf(group, /<dd[ >]/g)).toBe(1);
          }
          // Los hijos directos de <dl> son solo <div>: al quitar los grupos no queda ningún dt/dd suelto.
          const outside = body.replace(/<div[^>]*>[^]*?<\/div>/g, "");
          expect(outside).not.toMatch(/<(dt|dd)[ >]/);
        }
      }
    });
  });

  describe("ActiveLoansList", () => {
    it("no contiene <br en ninguna tarjeta", () => {
      expect(renderList([aLoanRow(), aLoanRow(OVERDUE)])).not.toContain("<br");
    });

    it("cada tarjeta conserva sus pares dt/dd con autor, persona y fechas", () => {
      const html = renderList([
        aLoanRow({ book_author: "Frank Herbert", member_name: "Ana Pérez", member_role: "DOCENTE" }),
      ]);

      expect(countOf(html, /<dl[ >]/g)).toBe(1);
      expect(countOf(html, /<dt[ >]/g)).toBe(4);
      expect(countOf(html, /<dd[ >]/g)).toBe(4);
      expect(html).toContain("Autor");
      expect(html).toContain("Persona:");
      expect(html).toContain("Prestado el:");
      expect(html).toContain("Vence el:");
      expect(html).toContain("Frank Herbert");
      expect(html).toContain("Ana Pérez");
      expect(html).toContain("Docente");
    });

    it("cada par dt/dd va envuelto en un <div> dentro de la <dl>, en todas las tarjetas", () => {
      const html = renderList([aLoanRow(), aLoanRow(OVERDUE)]);
      const bodies = dlBodies(html);

      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        const groups = divGroups(body);
        expect(groups).toHaveLength(4);
        for (const group of groups) {
          expect(countOf(group, /<dt[ >]/g)).toBe(1);
          expect(countOf(group, /<dd[ >]/g)).toBe(1);
        }
        const outside = body.replace(/<div[^>]*>[^]*?<\/div>/g, "");
        expect(outside).not.toMatch(/<(dt|dd)[ >]/);
      }
    });

    it("sin préstamos no pinta ninguna <dl>", () => {
      expect(renderList([])).not.toContain("<dl");
    });
  });
});

describe("LendForm (render inicial) sigue igual", () => {
  const html = renderToStaticMarkup(createElement(LendForm));

  it("tiene los dos buscadores y el botón «Prestar» deshabilitado", () => {
    expect(html).toContain("Buscar persona (nombre o correo)");
    expect(html).toContain("Buscar libro (título o autor)");
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Prestar<\/button>|<button[^>]*disabled=""[^>]*type="submit"[^>]*>Prestar<\/button>/,
    );
  });

  it("no muestra mensajes de resultado ni <br", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Préstamo registrado");
    expect(html).not.toContain("<br");
  });
});

// Nota: `readDueAt` de lend-form.tsx es privada del módulo (no se exporta), así que no se prueba aquí.
