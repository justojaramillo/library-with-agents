import { describe, expect, it } from "vitest";
import { computeDaysLate, createDailyFineStrategy } from "../server/fine-strategy";
import { DAY_MS, isoPlus, NOW } from "@/tests/helpers/loans";

describe("F7 · multa diaria por defecto (500 COP por día, tope 20 000)", () => {
  const fine = createDailyFineStrategy();

  it.each([
    [0, 0],
    [-1, 0],
    [-30, 0],
    [1, 500],
    [2, 1000],
    [39, 19_500],
    [40, 20_000],
    [41, 20_000],
    [365, 20_000],
  ])("con %i días de retraso la multa es %i COP", (daysLate, expected) => {
    expect(fine.calculate(daysLate)).toBe(expected);
  });

  it("el tope se alcanza exactamente a los 40 días", () => {
    expect(fine.calculate(39)).toBeLessThan(20_000);
    expect(fine.calculate(40)).toBe(20_000);
  });
});

describe("F7 · multa con otra tarifa y otro tope", () => {
  it("usa la tarifa y el tope recibidos", () => {
    const fine = createDailyFineStrategy(1000, 3500);
    expect(fine.calculate(0)).toBe(0);
    expect(fine.calculate(1)).toBe(1000);
    expect(fine.calculate(3)).toBe(3000);
    expect(fine.calculate(4)).toBe(3500);
    expect(fine.calculate(100)).toBe(3500);
  });

  it("sin retraso no cobra aunque la tarifa sea distinta", () => {
    expect(createDailyFineStrategy(1000, 3500).calculate(-5)).toBe(0);
  });

  it("con solo la tarifa usa el tope por defecto", () => {
    const fine = createDailyFineStrategy(1000);
    expect(fine.calculate(20)).toBe(20_000);
    expect(fine.calculate(21)).toBe(20_000);
  });
});

describe("F7 · días de retraso", () => {
  const dueAt = NOW.toISOString();

  it.each([
    ["24 h antes del vencimiento", -DAY_MS, 0],
    ["1 ms antes del vencimiento", -1, 0],
    ["exactamente en el vencimiento", 0, 0],
    ["1 ms después", 1, 1],
    ["12 horas después", DAY_MS / 2, 1],
    ["24 h después", DAY_MS, 1],
    ["24 h y 1 ms después", DAY_MS + 1, 2],
    ["48 h después", 2 * DAY_MS, 2],
    ["40 días después", 40 * DAY_MS, 40],
    ["41 días después", 41 * DAY_MS, 41],
  ])("%s: %i ms → %i días de retraso", (_name, offsetMs, expected) => {
    expect(computeDaysLate(dueAt, new Date(NOW.getTime() + offsetMs))).toBe(expected);
  });

  it("una fracción de día pasado el vencimiento cuenta como un día completo", () => {
    expect(computeDaysLate(isoPlus(NOW, -(DAY_MS + 1)), NOW)).toBe(2);
  });
});
