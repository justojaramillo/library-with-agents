import { describe, expect, it } from "vitest";
import { BORROWER_ROLES, ROLES, SELECTABLE_ROLES, STAFF_ROLES } from "@/shared/schema";

describe("ADR-0004 · roles del sistema", () => {
  it("existen exactamente los cinco roles", () => {
    expect([...ROLES].sort()).toEqual(["ADMINISTRADOR", "BIBLIOTECARIO", "DOCENTE", "ESTUDIANTE", "EXTERNO"]);
    expect(ROLES).toHaveLength(5);
  });

  it("los roles del sistema son exactamente los cinco definidos (no existe SOCIO)", () => {
    expect(ROLES as readonly string[]).not.toContain("SOCIO");
  });

  it("al registrarse solo se pueden elegir EXTERNO y ESTUDIANTE", () => {
    expect([...SELECTABLE_ROLES].sort()).toEqual(["ESTUDIANTE", "EXTERNO"]);
  });

  it("el personal es BIBLIOTECARIO y ADMINISTRADOR", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["ADMINISTRADOR", "BIBLIOTECARIO"]);
  });

  it("quienes piden prestado son EXTERNO, ESTUDIANTE y DOCENTE", () => {
    expect([...BORROWER_ROLES].sort()).toEqual(["DOCENTE", "ESTUDIANTE", "EXTERNO"]);
  });

  it("el personal y quienes piden prestado no se solapan", () => {
    const borrowers: readonly string[] = BORROWER_ROLES;
    for (const staffRole of STAFF_ROLES) {
      expect(borrowers).not.toContain(staffRole);
    }
  });

  it("personal y prestatarios juntos cubren todos los roles, sin repetir", () => {
    const together = [...STAFF_ROLES, ...BORROWER_ROLES];
    expect(together).toHaveLength(ROLES.length);
    expect([...together].sort()).toEqual([...ROLES].sort());
  });

  it("los roles seleccionables son un subconjunto de quienes piden prestado", () => {
    const borrowers: readonly string[] = BORROWER_ROLES;
    for (const selectable of SELECTABLE_ROLES) {
      expect(borrowers).toContain(selectable);
    }
  });
});
