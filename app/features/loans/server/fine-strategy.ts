import { LOAN_RULES } from "../schema";

/**
 * F7 · Patrón Strategy: la política de multas es intercambiable sin tocar el servicio de préstamos.
 */
export interface FineStrategy {
  /** Multa en COP para `daysLate` días de retraso (0 o menos → 0). */
  calculate(daysLate: number): number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Multa diaria con tope: `min(daysLate * ratePerDay, cap)`, y 0 si no hay retraso.
 * Sin argumentos usa los valores de `LOAN_RULES`.
 */
export function createDailyFineStrategy(
  ratePerDay: number = LOAN_RULES.fineCopPerDay,
  cap: number = LOAN_RULES.fineCapCop,
): FineStrategy {
  return {
    calculate(daysLate) {
      if (!(daysLate > 0)) {
        return 0;
      }
      return Math.min(daysLate * ratePerDay, cap);
    },
  };
}

/**
 * Días de retraso de un préstamo: 0 si `now` no pasa de `dueAt`; si no, cualquier fracción de día
 * cuenta como un día completo. Pura: el tiempo llega por parámetro.
 */
export function computeDaysLate(dueAt: string, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(dueAt);
  if (!(elapsedMs > 0)) {
    return 0;
  }
  return Math.ceil(elapsedMs / MS_PER_DAY);
}
