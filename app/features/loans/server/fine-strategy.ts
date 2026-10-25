import { LOAN_RULES } from "../schema";

/**
 * F7 · Patrón Strategy: la política de multas es intercambiable sin tocar el servicio de préstamos.
 */
export interface FineStrategy {
  /** Multa en COP para `daysLate` días de retraso (0 o menos → 0). */
  calculate(daysLate: number): number;
}

/**
 * TODO F7 — Multa diaria con tope: `min(daysLate * ratePerDay, cap)`, y 0 si no hay retraso.
 * Valores por defecto en `LOAN_RULES`.
 */
export function createDailyFineStrategy(
  ratePerDay: number = LOAN_RULES.fineCopPerDay,
  cap: number = LOAN_RULES.fineCapCop,
): FineStrategy {
  void ratePerDay;
  void cap;
  throw new Error("NOT_IMPLEMENTED: F7 · createDailyFineStrategy");
}
