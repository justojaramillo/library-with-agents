import { describe, expect, it } from "vitest";
import {
  checkEmulatorHosts,
  MIN_ORPHAN_AGE_MS,
  planDeletion,
  recheckBeforeDelete,
  type OrphanIdentity,
} from "@/shared/server/security/orphan-policy";

/** S1 reglas 8 y 11: decisión pura de qué identidades huérfanas de Authentication se pueden borrar. */
const NOW = new Date("2026-01-10T10:00:00.000Z");
const MINUTE = 60_000;
const SECOND = 1_000;

/** Una identidad creada hace `ageMs` milisegundos. */
function orphanAged(uid: string, ageMs: number): OrphanIdentity {
  return { uid, created: new Date(NOW.getTime() - ageMs).toISOString() };
}

/** `count` huérfanas antiguas (una hora). */
function oldOrphans(count: number): OrphanIdentity[] {
  const list: OrphanIdentity[] = [];
  for (let i = 0; i < count; i += 1) {
    list.push(orphanAged(`uid-${i}`, 60 * MINUTE));
  }
  return list;
}

type PlanOverrides = Partial<Parameters<typeof planDeletion<OrphanIdentity>>[0]>;

/** Entrada válida por defecto: proyecto confirmado, 2 huérfanas viejas de 100 identidades. */
function plan(over: PlanOverrides = {}) {
  return planDeletion({
    projectId: "mi-proyecto",
    projectFlag: "mi-proyecto",
    total: 100,
    orphans: oldOrphans(2),
    forceMany: false,
    now: NOW,
    ...over,
  });
}

describe("checkEmulatorHosts · emuladores coherentes", () => {
  it("solo el emulador de Authentication definido: aborta con un motivo", () => {
    const reason = checkEmulatorHosts("127.0.0.1:9099", undefined);

    expect(reason).not.toBeNull();
    expect(reason).toContain("FIREBASE_AUTH_EMULATOR_HOST");
  });

  it("solo el emulador de Firestore definido: aborta con un motivo", () => {
    const reason = checkEmulatorHosts(undefined, "127.0.0.1:8080");

    expect(reason).not.toBeNull();
    expect(reason).toContain("FIRESTORE_EMULATOR_HOST");
  });

  it("ambos definidos: no hay motivo de aborto", () => {
    expect(checkEmulatorHosts("127.0.0.1:9099", "127.0.0.1:8080")).toBeNull();
  });

  it("ninguno definido (Firebase real): no hay motivo de aborto", () => {
    expect(checkEmulatorHosts(undefined, undefined)).toBeNull();
  });
});

describe("planDeletion · confirmación del proyecto", () => {
  it("con todo en regla, las huérfanas antiguas son borrables", () => {
    const result = plan();

    expect(result.refusals).toEqual([]);
    expect(result.deletable.map((item) => item.uid)).toEqual(["uid-0", "uid-1"]);
    expect(result.skipped).toEqual([]);
  });

  it("se niega sin FIREBASE_PROJECT_ID", () => {
    const result = plan({ projectId: undefined });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("se niega con FIREBASE_PROJECT_ID vacío", () => {
    const result = plan({ projectId: "", projectFlag: "" });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("se niega sin --project", () => {
    const result = plan({ projectFlag: undefined });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("se niega con --project distinto de FIREBASE_PROJECT_ID", () => {
    const result = plan({ projectFlag: "otro-proyecto" });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("con rechazo, ninguna identidad es borrable aunque todas sean antiguas", () => {
    const result = plan({ projectFlag: "otro-proyecto", orphans: oldOrphans(5) });

    expect(result.deletable).toHaveLength(0);
  });
});

describe("planDeletion · proporción de huérfanas (la mitad o más se rechaza)", () => {
  it("49 huérfanas de 100 (49 %) se pueden borrar", () => {
    const result = plan({ total: 100, orphans: oldOrphans(49) });

    expect(result.refusals).toEqual([]);
    expect(result.deletable).toHaveLength(49);
  });

  it("50 de 100 (50 %) se rechaza sin --force-many", () => {
    const result = plan({ total: 100, orphans: oldOrphans(50) });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("100 de 100 (todas huérfanas) se rechaza sin --force-many", () => {
    const result = plan({ total: 100, orphans: oldOrphans(100) });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("50 de 100 con --force-many pasa", () => {
    const result = plan({ total: 100, orphans: oldOrphans(50), forceMany: true });

    expect(result.refusals).toEqual([]);
    expect(result.deletable).toHaveLength(50);
  });

  it("100 de 100 con --force-many pasa", () => {
    const result = plan({ total: 100, orphans: oldOrphans(100), forceMany: true });

    expect(result.refusals).toEqual([]);
    expect(result.deletable).toHaveLength(100);
  });

  it("--force-many no salta la confirmación del proyecto", () => {
    const result = plan({ total: 10, orphans: oldOrphans(10), forceMany: true, projectFlag: undefined });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.deletable).toEqual([]);
  });

  it("1 huérfana de 2 identidades (50 %) se rechaza sin --force-many", () => {
    const result = plan({ total: 2, orphans: oldOrphans(1) });

    expect(result.deletable).toEqual([]);
    expect(result.refusals.length).toBeGreaterThan(0);
  });

  it("sin huérfanas no hay nada que borrar ni rechazo", () => {
    const result = plan({ orphans: [] });

    expect(result.refusals).toEqual([]);
    expect(result.deletable).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("planDeletion · identidades demasiado recientes", () => {
  it("el mínimo de edad es de 10 minutos", () => {
    expect(MIN_ORPHAN_AGE_MS).toBe(10 * MINUTE);
  });

  it("creada hace 2 minutos: se salta", () => {
    const result = plan({ orphans: [orphanAged("reciente", 2 * MINUTE)] });

    expect(result.deletable).toEqual([]);
    expect(result.skipped.map((item) => item.uid)).toEqual(["reciente"]);
    expect(result.skipped[0]?.reason).not.toBe("");
  });

  it("creada hace 9 min 59 s: se salta (límite − 1 s)", () => {
    const result = plan({ orphans: [orphanAged("casi", 10 * MINUTE - SECOND)] });

    expect(result.deletable).toEqual([]);
    expect(result.skipped.map((item) => item.uid)).toEqual(["casi"]);
  });

  it("creada hace exactamente 10 minutos: ya se puede borrar", () => {
    const result = plan({ orphans: [orphanAged("justa", 10 * MINUTE)] });

    expect(result.skipped).toEqual([]);
    expect(result.deletable.map((item) => item.uid)).toEqual(["justa"]);
  });

  it("creada hace 10 min 1 s: se puede borrar", () => {
    const result = plan({ orphans: [orphanAged("pasada", 10 * MINUTE + SECOND)] });

    expect(result.deletable.map((item) => item.uid)).toEqual(["pasada"]);
  });

  it("con fecha ilegible se salta", () => {
    const result = plan({ orphans: [{ uid: "rara", created: "no es una fecha" }] });

    expect(result.deletable).toEqual([]);
    expect(result.skipped.map((item) => item.uid)).toEqual(["rara"]);
  });

  it("con fecha vacía se salta", () => {
    const result = plan({ orphans: [{ uid: "vacia", created: "" }] });

    expect(result.deletable).toEqual([]);
    expect(result.skipped.map((item) => item.uid)).toEqual(["vacia"]);
  });

  it("mezcla: borra las antiguas y salta las recientes, cada una por separado", () => {
    const result = plan({
      orphans: [orphanAged("vieja", 60 * MINUTE), orphanAged("nueva", MINUTE), orphanAged("otra-vieja", 30 * MINUTE)],
    });

    expect(result.deletable.map((item) => item.uid)).toEqual(["vieja", "otra-vieja"]);
    expect(result.skipped.map((item) => item.uid)).toEqual(["nueva"]);
  });

  it("no modifica la lista de entrada", () => {
    const orphans = [orphanAged("vieja", 60 * MINUTE), orphanAged("nueva", MINUTE)];

    plan({ orphans });

    expect(orphans.map((item) => item.uid)).toEqual(["vieja", "nueva"]);
  });
});

describe("recheckBeforeDelete · última comprobación antes de cada deleteUser", () => {
  it("antigua y sin documento: se puede borrar (null)", () => {
    expect(recheckBeforeDelete(orphanAged("a", 60 * MINUTE), false, NOW)).toBeNull();
  });

  it("si ya existe el documento members/{uid}: se salta con un motivo", () => {
    const reason = recheckBeforeDelete(orphanAged("a", 60 * MINUTE), true, NOW);

    expect(reason).not.toBeNull();
  });

  it("si se creó hace menos de 10 minutos: se salta con un motivo", () => {
    expect(recheckBeforeDelete(orphanAged("a", 2 * MINUTE), false, NOW)).not.toBeNull();
    expect(recheckBeforeDelete(orphanAged("a", 10 * MINUTE - SECOND), false, NOW)).not.toBeNull();
  });

  it("creada hace exactamente 10 minutos: se puede borrar", () => {
    expect(recheckBeforeDelete(orphanAged("a", 10 * MINUTE), false, NOW)).toBeNull();
  });

  it("reciente y con documento: se salta", () => {
    expect(recheckBeforeDelete(orphanAged("a", MINUTE), true, NOW)).not.toBeNull();
  });
});
