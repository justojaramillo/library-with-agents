import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/shared/schema";
import { canChangeActive } from "../server/staff-service";
import { activeNoticeText, canShowToggle, describeActiveState } from "../ui/active-rules";

/**
 * Regla 7 de F13–F14 escrita a mano (actor → destino ajeno): los prestatarios nunca; el bibliotecario solo sobre
 * externo, estudiante y docente; el administrador sobre todos menos el administrador. Sobre uno mismo nadie.
 */
const OTHER_ACCOUNT: Record<Role, Record<Role, boolean>> = {
  EXTERNO: { EXTERNO: false, ESTUDIANTE: false, DOCENTE: false, BIBLIOTECARIO: false, ADMINISTRADOR: false },
  ESTUDIANTE: { EXTERNO: false, ESTUDIANTE: false, DOCENTE: false, BIBLIOTECARIO: false, ADMINISTRADOR: false },
  DOCENTE: { EXTERNO: false, ESTUDIANTE: false, DOCENTE: false, BIBLIOTECARIO: false, ADMINISTRADOR: false },
  BIBLIOTECARIO: { EXTERNO: true, ESTUDIANTE: true, DOCENTE: true, BIBLIOTECARIO: false, ADMINISTRADOR: false },
  ADMINISTRADOR: { EXTERNO: true, ESTUDIANTE: true, DOCENTE: true, BIBLIOTECARIO: true, ADMINISTRADOR: false },
};

describe("F14 · canShowToggle · matriz de la regla 7 sobre otra cuenta", () => {
  for (const actorRole of ROLES) {
    for (const targetRole of ROLES) {
      const expected = OTHER_ACCOUNT[actorRole][targetRole];
      let verb = "no ve el botón";
      if (expected) {
        verb = "ve el botón";
      }
      it(`${actorRole} ${verb} sobre otra cuenta ${targetRole}`, () => {
        expect(canShowToggle(actorRole, "uid-actor", { id: "uid-otro", role: targetRole })).toBe(expected);
      });
    }
  }
});

describe("F14 · canShowToggle · nadie cambia su propia cuenta", () => {
  for (const actorRole of ROLES) {
    it(`${actorRole} no ve el botón sobre su propia cuenta`, () => {
      expect(canShowToggle(actorRole, "uid-yo", { id: "uid-yo", role: actorRole })).toBe(false);
    });
  }

  it("el administrador no ve el botón sobre sí mismo ni sobre otro administrador", () => {
    expect(canShowToggle("ADMINISTRADOR", "uid-admin", { id: "uid-admin", role: "ADMINISTRADOR" })).toBe(false);
    expect(canShowToggle("ADMINISTRADOR", "uid-admin", { id: "uid-otro", role: "ADMINISTRADOR" })).toBe(false);
  });

  it("un bibliotecario no ve el botón sobre otro bibliotecario, pero sí sobre un estudiante", () => {
    expect(canShowToggle("BIBLIOTECARIO", "uid-a", { id: "uid-b", role: "BIBLIOTECARIO" })).toBe(false);
    expect(canShowToggle("BIBLIOTECARIO", "uid-a", { id: "uid-b", role: "ESTUDIANTE" })).toBe(true);
  });

  it("la cuenta propia se reconoce por el id de la sesión, no por el rol", () => {
    expect(canShowToggle("ADMINISTRADOR", "uid-admin", { id: "uid-bib", role: "BIBLIOTECARIO" })).toBe(true);
    expect(canShowToggle("ADMINISTRADOR", "uid-bib", { id: "uid-bib", role: "BIBLIOTECARIO" })).toBe(false);
  });
});

describe("F14 · canShowToggle · coherente con lo que el servidor permite", () => {
  for (const actorRole of ROLES) {
    for (const targetRole of ROLES) {
      it(`${actorRole} sobre ${targetRole}: la pantalla ofrece el botón solo si el servicio lo permitiría`, () => {
        const other = { id: "uid-otro", role: targetRole };
        expect(canShowToggle(actorRole, "uid-actor", other)).toBe(
          canChangeActive(actorRole, "uid-actor", other).allowed,
        );
        const self = { id: "uid-actor", role: targetRole };
        expect(canShowToggle(actorRole, "uid-actor", self)).toBe(canChangeActive(actorRole, "uid-actor", self).allowed);
      });
    }
  }
});

describe("F14 · textos del estado", () => {
  it("una cuenta activa se describe «Activa» y una inactiva «Inactiva»", () => {
    expect(describeActiveState(true)).toBe("Activa");
    expect(describeActiveState(false)).toBe("Inactiva");
  });

  it("el aviso de éxito al desactivar dice «{Nombre} ahora está inactiva.»", () => {
    expect(activeNoticeText("Ana Pérez", false)).toBe("Ana Pérez ahora está inactiva.");
  });

  it("el aviso de éxito al reactivar dice «{Nombre} ahora está activa.»", () => {
    expect(activeNoticeText("Ana Pérez", true)).toBe("Ana Pérez ahora está activa.");
  });

  it("el aviso no interpreta el nombre (se muestra tal cual; React lo escapa)", () => {
    expect(activeNoticeText("<b>Ana</b>", true)).toBe("<b>Ana</b> ahora está activa.");
  });
});
