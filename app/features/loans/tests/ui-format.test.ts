import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, formatCop, formatDate, formatDateTime, formatDaysLate } from "@/features/loans/ui/format";

/** Vencimiento del ejemplo de la spec F34–F35 (criterio de la zona horaria). */
const DUE_AT = "2026-01-30T20:45:00.000Z";

describe("F34–F35 · formato de fechas", () => {
  it("la zona por defecto del HTML inicial es America/Bogota", () => {
    expect(DEFAULT_TIME_ZONE).toBe("America/Bogota");
  });

  describe("formatDateTime (fecha y hora)", () => {
    it("en America/Bogota muestra «30 de enero de 2026, 3:45 p. m.»", () => {
      expect(formatDateTime(DUE_AT, "America/Bogota")).toBe("30 de enero de 2026, 3:45 p. m.");
    });

    it("en America/Mexico_City muestra «30 de enero de 2026, 2:45 p. m.»", () => {
      expect(formatDateTime(DUE_AT, "America/Mexico_City")).toBe("30 de enero de 2026, 2:45 p. m.");
    });

    it("usa a. m. por la mañana", () => {
      expect(formatDateTime("2026-01-30T14:05:00.000Z", "America/Bogota")).toBe("30 de enero de 2026, 9:05 a. m.");
    });

    it("el mediodía y la medianoche locales se muestran como 12:xx p. m. y 12:xx a. m.", () => {
      expect(formatDateTime("2026-01-30T17:00:00.000Z", "America/Bogota")).toBe("30 de enero de 2026, 12:00 p. m.");
      expect(formatDateTime("2026-01-30T05:30:00.000Z", "America/Bogota")).toBe("30 de enero de 2026, 12:30 a. m.");
    });

    it("el día cambia según la zona: lo que en UTC es el 31 en Bogotá sigue siendo el 30", () => {
      expect(formatDateTime("2026-01-31T03:30:00.000Z", "America/Bogota")).toBe("30 de enero de 2026, 10:30 p. m.");
      expect(formatDateTime("2026-01-31T03:30:00.000Z", "Asia/Tokyo")).toBe("31 de enero de 2026, 12:30 p. m.");
    });

    it("solo usa espacios normales (sin espacios de no separación)", () => {
      expect(formatDateTime(DUE_AT, "America/Bogota")).not.toMatch(/[\u00a0\u202f]/);
    });
  });

  describe("formatDate (solo fecha)", () => {
    it("muestra «30 de enero de 2026»", () => {
      expect(formatDate(DUE_AT, "America/Bogota")).toBe("30 de enero de 2026");
      expect(formatDate(DUE_AT, "America/Mexico_City")).toBe("30 de enero de 2026");
    });

    it("no lleva hora", () => {
      expect(formatDate(DUE_AT, "America/Bogota")).not.toMatch(/\d:\d/);
    });

    it("la fecha depende de la zona cerca de la medianoche UTC", () => {
      expect(formatDate("2026-01-31T03:30:00.000Z", "America/Bogota")).toBe("30 de enero de 2026");
      expect(formatDate("2026-01-31T03:30:00.000Z", "Asia/Tokyo")).toBe("31 de enero de 2026");
    });

    it("escribe el día sin cero a la izquierda y el mes en español", () => {
      expect(formatDate("2026-03-05T18:00:00.000Z", "America/Bogota")).toBe("5 de marzo de 2026");
      expect(formatDate("2026-12-25T18:00:00.000Z", "America/Bogota")).toBe("25 de diciembre de 2026");
    });
  });

  describe("zona horaria inválida", () => {
    it("formatDateTime cae en America/Bogota", () => {
      expect(formatDateTime(DUE_AT, "Zona/Inventada")).toBe(formatDateTime(DUE_AT, "America/Bogota"));
      expect(formatDateTime(DUE_AT, "Zona/Inventada")).toBe("30 de enero de 2026, 3:45 p. m.");
    });

    it("formatDate cae en America/Bogota", () => {
      expect(formatDate("2026-01-31T03:30:00.000Z", "Zona/Inventada")).toBe("30 de enero de 2026");
    });

    it("una zona vacía también cae en America/Bogota", () => {
      expect(formatDateTime(DUE_AT, "")).toBe("30 de enero de 2026, 3:45 p. m.");
    });
  });
});

describe("F34–F35 · formato de dinero (COP)", () => {
  it("muestra «$20.000 COP» para el tope de la multa", () => {
    expect(formatCop(20_000)).toBe("$20.000 COP");
  });

  it("muestra «$1.500 COP» (cuatro cifras llevan separador de miles)", () => {
    expect(formatCop(1_500)).toBe("$1.500 COP");
  });

  it("muestra «$500 COP» para un día de multa", () => {
    expect(formatCop(500)).toBe("$500 COP");
  });

  it("muestra «$0 COP» sin multa", () => {
    expect(formatCop(0)).toBe("$0 COP");
  });

  it("agrupa los millones con puntos", () => {
    expect(formatCop(1_234_567)).toBe("$1.234.567 COP");
  });
});

describe("F34–F35 · días de retraso", () => {
  it("1 día en singular", () => {
    expect(formatDaysLate(1)).toBe("1 día");
  });

  it("N días en plural desde 2", () => {
    expect(formatDaysLate(2)).toBe("2 días");
    expect(formatDaysLate(3)).toBe("3 días");
    expect(formatDaysLate(40)).toBe("40 días");
  });

  it("el cero va en plural", () => {
    expect(formatDaysLate(0)).toBe("0 días");
  });
});
