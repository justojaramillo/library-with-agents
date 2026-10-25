import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/shared/schema";
import { ForbiddenError } from "@/shared/server/errors";
import { makeStaffWorld, type StaffPerson, type StaffWorld } from "@/tests/helpers/staff";
import { canChangeActive } from "../server/staff-service";

const ONLY_ADMIN_MESSAGE = "El administrador no se puede desactivar.";
const SELF_MESSAGE = "No puedes cambiar el estado de tu propia cuenta.";
const OTHER_STAFF_MESSAGE = "Un bibliotecario no puede cambiar el estado de otro personal.";
const BORROWERS = ["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[];

describe("F14 · canChangeActive · la matriz de la regla 7 como función pura", () => {
  it.each(BORROWERS)("un bibliotecario puede cambiar a otra cuenta %s", (role) => {
    expect(canChangeActive("BIBLIOTECARIO", "actor", { id: "otra", role })).toEqual({ allowed: true });
  });

  it.each(BORROWERS)("el administrador puede cambiar a otra cuenta %s", (role) => {
    expect(canChangeActive("ADMINISTRADOR", "actor", { id: "otra", role })).toEqual({ allowed: true });
  });

  it("el administrador puede cambiar a otro bibliotecario", () => {
    expect(canChangeActive("ADMINISTRADOR", "actor", { id: "otra", role: "BIBLIOTECARIO" })).toEqual({
      allowed: true,
    });
  });

  it("un bibliotecario sobre otro bibliotecario: no, con el mensaje de personal", () => {
    expect(canChangeActive("BIBLIOTECARIO", "actor", { id: "otra", role: "BIBLIOTECARIO" })).toEqual({
      allowed: false,
      message: OTHER_STAFF_MESSAGE,
    });
  });

  it("un bibliotecario sobre el administrador: no, con el mensaje del administrador", () => {
    expect(canChangeActive("BIBLIOTECARIO", "actor", { id: "admin", role: "ADMINISTRADOR" })).toEqual({
      allowed: false,
      message: ONLY_ADMIN_MESSAGE,
    });
  });

  it("el administrador sobre el administrador (otra cuenta): no, con el mensaje del administrador", () => {
    expect(canChangeActive("ADMINISTRADOR", "actor", { id: "otro-admin", role: "ADMINISTRADOR" })).toEqual({
      allowed: false,
      message: ONLY_ADMIN_MESSAGE,
    });
  });

  it("el administrador sobre sí mismo: gana «destino administrador» sobre «sobre sí mismo»", () => {
    expect(canChangeActive("ADMINISTRADOR", "admin", { id: "admin", role: "ADMINISTRADOR" })).toEqual({
      allowed: false,
      message: ONLY_ADMIN_MESSAGE,
    });
  });

  it("un bibliotecario sobre sí mismo: gana «sobre sí mismo» sobre «otro personal»", () => {
    expect(canChangeActive("BIBLIOTECARIO", "yo", { id: "yo", role: "BIBLIOTECARIO" })).toEqual({
      allowed: false,
      message: SELF_MESSAGE,
    });
  });
});

let w: StaffWorld;
let librarian: StaffPerson;
let admin: StaffPerson;

beforeEach(async () => {
  w = makeStaffWorld();
  librarian = await w.addPerson("BIBLIOTECARIO");
  admin = await w.addPerson("ADMINISTRADOR");
});

async function rejectionOf<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("Se esperaba un rechazo y la operación terminó bien");
}

/** Pide el cambio, comprueba que se rechaza con 403 y el mensaje, y que la cuenta no cambió. */
async function expectForbidden(actor: StaffPerson, target: StaffPerson, active: boolean, message: string) {
  const before = await w.stored(target);

  const error = await rejectionOf(w.staff.setActive(actor.actor, target.id, active));

  expect(error).toBeInstanceOf(ForbiddenError);
  expect(error.message).toBe(message);
  expect(await w.stored(target)).toEqual(before);
}

describe("F14 · el bibliotecario cambia el estado (regla 7, fila BIBLIOTECARIO)", () => {
  it.each(BORROWERS)("desactiva y reactiva a un %s", async (role) => {
    const target = await w.addPerson(role);

    const off = await w.staff.setActive(librarian.actor, target.id, false);
    expect(off).toEqual({ id: target.id, name: target.name, email: target.email, role, active: false });
    expect((await w.stored(target))?.active).toBe(false);

    const on = await w.staff.setActive(librarian.actor, target.id, true);
    expect(on.active).toBe(true);
    expect((await w.stored(target))?.active).toBe(true);
  });

  it.each([false, true])("sobre otro bibliotecario (pedir active=%s): 403 y nada cambia", async (active) => {
    const other = await w.addWithState("BIBLIOTECARIO", !active);

    await expectForbidden(librarian, other, active, OTHER_STAFF_MESSAGE);
  });

  it.each([false, true])("sobre el administrador (pedir active=%s): 403 y nada cambia", async (active) => {
    await w.repos.members.setActive(admin.id, !active);

    await expectForbidden(librarian, admin, active, ONLY_ADMIN_MESSAGE);
  });

  it.each([false, true])("sobre sí mismo (pedir active=%s): 403 «No puedes…» y nada cambia", async (active) => {
    await w.repos.members.setActive(librarian.id, !active);

    await expectForbidden(librarian, librarian, active, SELF_MESSAGE);
  });
});

describe("F14 · el administrador cambia el estado (regla 7, fila ADMINISTRADOR)", () => {
  it.each([...BORROWERS, "BIBLIOTECARIO"] satisfies Role[])("desactiva y reactiva a un %s", async (role) => {
    const target = await w.addPerson(role);

    const off = await w.staff.setActive(admin.actor, target.id, false);
    expect(off.active).toBe(false);
    expect(off.role).toBe(role);

    const on = await w.staff.setActive(admin.actor, target.id, true);
    expect(on.active).toBe(true);
    expect((await w.stored(target))?.active).toBe(true);
  });

  it.each([
    false,
    true,
  ])("sobre sí mismo, el administrador (pedir active=%s): 403 del administrador", async (active) => {
    await w.repos.members.setActive(admin.id, !active);

    await expectForbidden(admin, admin, active, ONLY_ADMIN_MESSAGE);
  });

  it("el administrador no puede desactivarse aunque sea el único administrador activo", async () => {
    await expectForbidden(admin, admin, false, ONLY_ADMIN_MESSAGE);
    expect((await w.stored(admin))?.active).toBe(true);
  });
});

describe("F14 · prioridad de los mensajes cuando se cumplen varias condiciones (regla 7)", () => {
  it("un bibliotecario sobre sí mismo recibe «sobre sí mismo», no «otro personal»", async () => {
    await expectForbidden(librarian, librarian, false, SELF_MESSAGE);
  });

  it("un bibliotecario sobre el administrador recibe «administrador», no «otro personal»", async () => {
    await expectForbidden(librarian, admin, false, ONLY_ADMIN_MESSAGE);
  });
});
