import { describe, expect, it } from "vitest";
import { LendInputSchema, OverdueLoanSchema, ReturnResultSchema } from "../schema";

describe("F5 · entrada de prestar (LendInput)", () => {
  it("acepta member_id y book_id no vacíos", () => {
    const parsed = LendInputSchema.safeParse({ member_id: "m1", book_id: "b1" });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["member_id vacío", { member_id: "", book_id: "b1" }],
    ["book_id vacío", { member_id: "m1", book_id: "" }],
    ["ambos vacíos", { member_id: "", book_id: "" }],
  ])("rechaza %s", (_name, body) => {
    expect(LendInputSchema.safeParse(body).success).toBe(false);
  });

  it("rechaza si falta member_id o book_id", () => {
    expect(LendInputSchema.safeParse({ book_id: "b1" }).success).toBe(false);
    expect(LendInputSchema.safeParse({ member_id: "m1" }).success).toBe(false);
    expect(LendInputSchema.safeParse({}).success).toBe(false);
  });

  it("rechaza ids que no son texto", () => {
    expect(LendInputSchema.safeParse({ member_id: 1, book_id: "b1" }).success).toBe(false);
    expect(LendInputSchema.safeParse({ member_id: "m1", book_id: null }).success).toBe(false);
  });

  it("ignora campos extra como role o due_at: nunca llegan al servicio", () => {
    const parsed = LendInputSchema.safeParse({ member_id: "m1", book_id: "b1", role: "DOCENTE", due_at: "2030-01-01" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ member_id: "m1", book_id: "b1" });
    }
  });
});

describe("F6 y F8 · formas de respuesta", () => {
  const loan = {
    id: "l1",
    book_id: "b1",
    member_id: "m1",
    loaned_at: "2026-01-10T10:00:00.000Z",
    due_at: "2026-01-30T10:00:00.000Z",
    returned_at: null,
  };

  it("ReturnResult exige una multa entera no negativa", () => {
    expect(ReturnResultSchema.safeParse({ loan, fine_cop: 0 }).success).toBe(true);
    expect(ReturnResultSchema.safeParse({ loan, fine_cop: -1 }).success).toBe(false);
    expect(ReturnResultSchema.safeParse({ loan, fine_cop: 1.5 }).success).toBe(false);
  });

  it("OverdueLoan exige al menos 1 día de retraso", () => {
    expect(OverdueLoanSchema.safeParse({ loan, days_late: 1, fine_cop: 500 }).success).toBe(true);
    expect(OverdueLoanSchema.safeParse({ loan, days_late: 0, fine_cop: 0 }).success).toBe(false);
  });
});
