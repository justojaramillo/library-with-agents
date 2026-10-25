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

  it("cada persona puede tener como máximo 3 préstamos activos", () => {
    expect(LOAN_RULES.maxActiveLoansPerMember).toBe(3);
  });
});
