import { describe, expect, it } from "vitest";
import { joinLoanRows } from "@/features/loans/ui/loan-rows";
import type { ActiveLoan } from "@/features/loans/schema";

const NOW_ISO = "2026-01-10T10:00:00.000Z";

function anActiveLoan(id: string, bookId: string, memberId: string, over: Partial<ActiveLoan> = {}): ActiveLoan {
  return {
    loan: {
      id,
      book_id: bookId,
      member_id: memberId,
      loaned_at: "2026-01-01T10:00:00.000Z",
      due_at: NOW_ISO,
      returned_at: null,
    },
    days_late: 0,
    fine_cop: 0,
    ...over,
  };
}

const ANA = { id: "m1", name: "Ana Pérez", role: "ESTUDIANTE" } as const;
const LUIS = { id: "m2", name: "Luis Gómez", role: "DOCENTE" } as const;
const DUNE = { id: "b1", title: "Dune", author: "Frank Herbert" };
const EMMA = { id: "b2", title: "Emma", author: "Jane Austen" };

describe("F34–F35 · joinLoanRows (une préstamos con libros y cuentas)", () => {
  it("sin préstamos devuelve una lista vacía", () => {
    expect(joinLoanRows([], [ANA], [DUNE])).toEqual([]);
  });

  it("une el préstamo con el título, el autor, el nombre y el rol", () => {
    const rows = joinLoanRows([anActiveLoan("l1", "b1", "m1")], [ANA], [DUNE]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      loan_id: "l1",
      book_title: "Dune",
      book_author: "Frank Herbert",
      member_name: "Ana Pérez",
      member_role: "ESTUDIANTE",
    });
  });

  it("conserva las fechas, los días de retraso y la multa del préstamo", () => {
    const active = anActiveLoan("l1", "b1", "m1", { days_late: 3, fine_cop: 1_500 });
    const [row] = joinLoanRows([active], [ANA], [DUNE]);
    expect(row?.loaned_at).toBe(active.loan.loaned_at);
    expect(row?.due_at).toBe(active.loan.due_at);
    expect(row?.days_late).toBe(3);
    expect(row?.fine_cop).toBe(1_500);
  });

  it("conserva el orden de entrada (no reordena por título, nombre ni fecha)", () => {
    const active = [anActiveLoan("l-z", "b2", "m2"), anActiveLoan("l-a", "b1", "m1"), anActiveLoan("l-m", "b2", "m1")];
    const rows = joinLoanRows(active, [ANA, LUIS], [DUNE, EMMA]);
    expect(rows.map((row) => row.loan_id)).toEqual(["l-z", "l-a", "l-m"]);
  });

  it("el orden de las cuentas y libros recibidos no altera el de las filas", () => {
    const active = [anActiveLoan("l1", "b1", "m1"), anActiveLoan("l2", "b2", "m2")];
    const rows = joinLoanRows(active, [LUIS, ANA], [EMMA, DUNE]);
    expect(rows.map((row) => row.book_title)).toEqual(["Dune", "Emma"]);
    expect(rows.map((row) => row.member_name)).toEqual(["Ana Pérez", "Luis Gómez"]);
  });

  it("dos préstamos de la misma persona y el mismo libro dan dos filas", () => {
    const active = [anActiveLoan("l1", "b1", "m1"), anActiveLoan("l2", "b1", "m1")];
    expect(joinLoanRows(active, [ANA], [DUNE])).toHaveLength(2);
  });

  describe("libro borrado (regla 9)", () => {
    it("muestra «Libro no disponible» con el id y conserva el préstamo", () => {
      const [row] = joinLoanRows([anActiveLoan("l1", "b-borrado", "m1")], [ANA], [DUNE]);
      expect(row?.book_title).toContain("Libro no disponible");
      expect(row?.book_title).toContain("b-borrado");
      expect(row?.loan_id).toBe("l1");
      expect(row?.member_name).toBe("Ana Pérez");
    });

    it("sin ningún libro todas las filas dicen «Libro no disponible»", () => {
      const active = [anActiveLoan("l1", "b1", "m1"), anActiveLoan("l2", "b2", "m1")];
      const rows = joinLoanRows(active, [ANA], []);
      expect(rows.map((row) => row.book_title.startsWith("Libro no disponible"))).toEqual([true, true]);
    });
  });

  describe("cuenta borrada (regla 9)", () => {
    it("muestra «Cuenta no disponible» con el id, sin rol, y conserva el préstamo", () => {
      const [row] = joinLoanRows([anActiveLoan("l1", "b1", "m-borrada")], [ANA], [DUNE]);
      expect(row?.member_name).toContain("Cuenta no disponible");
      expect(row?.member_name).toContain("m-borrada");
      expect(row?.member_role).toBeNull();
      expect(row?.book_title).toBe("Dune");
    });

    it("sin ninguna cuenta todas las filas dicen «Cuenta no disponible»", () => {
      const active = [anActiveLoan("l1", "b1", "m1"), anActiveLoan("l2", "b1", "m2")];
      const rows = joinLoanRows(active, [], [DUNE]);
      expect(rows.map((row) => row.member_name.startsWith("Cuenta no disponible"))).toEqual([true, true]);
    });
  });

  it("libro y cuenta borrados a la vez: la fila existe con ambos avisos", () => {
    const [row] = joinLoanRows([anActiveLoan("l1", "b-x", "m-x", { days_late: 2, fine_cop: 1_000 })], [], []);
    expect(row?.book_title).toContain("Libro no disponible");
    expect(row?.member_name).toContain("Cuenta no disponible");
    expect(row?.days_late).toBe(2);
    expect(row?.fine_cop).toBe(1_000);
  });
});
