import { describe, expect, it } from "vitest";
import { BORROWER_ROLES } from "@/shared/schema";
import { LOAN_RULES } from "../schema";

describe("ADR-0004 · reglas de préstamo por rol", () => {
  it("los plazos son 15 días para externo, 20 para estudiante y 30 para docente", () => {
    expect(LOAN_RULES.loanDaysByRole).toEqual({ EXTERNO: 15, ESTUDIANTE: 20, DOCENTE: 30 });
  });

  it("solo hay plazo para quienes piden prestado", () => {
    expect(Object.keys(LOAN_RULES.loanDaysByRole).sort()).toEqual([...BORROWER_ROLES].sort());
  });

  it("los plazos dependen del rol: no hay un plazo único", () => {
    expect(LOAN_RULES).not.toHaveProperty("loanDays");
  });
});

describe("F5 · cupo de préstamos activos por rol", () => {
  it("el cupo es 3 para externo, 3 para estudiante y 5 para docente", () => {
    expect(LOAN_RULES.maxActiveLoansByRole).toEqual({ EXTERNO: 3, ESTUDIANTE: 3, DOCENTE: 5 });
  });

  it("solo hay cupo para quienes piden prestado", () => {
    expect(Object.keys(LOAN_RULES.maxActiveLoansByRole).sort()).toEqual([...BORROWER_ROLES].sort());
  });

  it("el cupo depende del rol: ya no existe un máximo único por persona", () => {
    expect(LOAN_RULES).not.toHaveProperty("maxActiveLoansPerMember");
  });
});

describe("F24 · renovaciones permitidas por rol (se fijan desde F5)", () => {
  it("son 2 para externo, 2 para estudiante y 3 para docente", () => {
    expect(LOAN_RULES.maxRenewalsByRole).toEqual({ EXTERNO: 2, ESTUDIANTE: 2, DOCENTE: 3 });
  });

  it("solo hay renovaciones para quienes piden prestado", () => {
    expect(Object.keys(LOAN_RULES.maxRenewalsByRole).sort()).toEqual([...BORROWER_ROLES].sort());
  });
});

describe("F7 · multa por defecto", () => {
  it("son 500 COP por día con un tope de 20 000 COP", () => {
    expect(LOAN_RULES.fineCopPerDay).toBe(500);
    expect(LOAN_RULES.fineCapCop).toBe(20_000);
  });
});
