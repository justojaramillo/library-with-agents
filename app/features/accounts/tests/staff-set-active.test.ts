import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { Role } from "@/shared/schema";
import { ForbiddenError, NotFoundError } from "@/shared/server/errors";
import { makeStaffWorld, type StaffPerson, type StaffWorld } from "@/tests/helpers/staff";
import { MemberSchema, SetMemberActiveInputSchema } from "../schema";

const STAFF_ONLY_MESSAGE = "Solo para personal de la biblioteca";
const BORROWERS = ["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[];
const BAD_IDS = [
  ["con «/»", "a/b"],
  ["de 129 caracteres", "x".repeat(129)],
  ["vacío", ""],
  ["reservado «.»", "."],
  ["reservado «..»", ".."],
  ["reservado «__x__»", "__x__"],
] satisfies [string, string][];

let w: StaffWorld;
let librarian: StaffPerson;
let admin: StaffPerson;
let student: StaffPerson;

beforeEach(async () => {
  w = makeStaffWorld();
  librarian = await w.addPerson("BIBLIOTECARIO");
  admin = await w.addPerson("ADMINISTRADOR");
  student = await w.addPerson("ESTUDIANTE");
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

describe("F14 · el contrato de entrada del cambio de estado", () => {
  it("acepta active true y false", () => {
    expect(SetMemberActiveInputSchema.safeParse({ active: true }).success).toBe(true);
    expect(SetMemberActiveInputSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("rechaza active ausente, null, cadena y número", () => {
    expect(SetMemberActiveInputSchema.safeParse({}).success).toBe(false);
    expect(SetMemberActiveInputSchema.safeParse({ active: null }).success).toBe(false);
    expect(SetMemberActiveInputSchema.safeParse({ active: "true" }).success).toBe(false);
    expect(SetMemberActiveInputSchema.safeParse({ active: 1 }).success).toBe(false);
  });
});

describe("F14 · orden de las comprobaciones (regla 8)", () => {
  it.each(
    BORROWERS,
  )("un %s recibe 403 «Solo para personal…» aunque el :id y el cuerpo sean inválidos", async (role) => {
    const borrower = await w.addPerson(role);

    const error = await rejectionOf(w.staff.setActive(borrower.actor, "a/b", undefined));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe(STAFF_ONLY_MESSAGE);
  });

  it.each(BORROWERS)("un %s recibe 403 aunque la cuenta destino no exista", async (role) => {
    const borrower = await w.addPerson(role);

    const error = await rejectionOf(w.staff.setActive(borrower.actor, "no-existe", false));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe(STAFF_ONLY_MESSAGE);
  });

  it.each(BORROWERS)("un %s no puede cambiar el estado de otra persona ni el suyo", async (role) => {
    const borrower = await w.addPerson(role);

    await expect(w.staff.setActive(borrower.actor, student.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.staff.setActive(borrower.actor, borrower.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await w.stored(student))?.active).toBe(true);
    expect((await w.stored(borrower))?.active).toBe(true);
  });

  it.each(BAD_IDS)("un :id %s da error de validación (400)", async (_name, id) => {
    await expect(w.staff.setActive(librarian.actor, id, false)).rejects.toBeInstanceOf(ZodError);
  });

  it("un :id de 128 caracteres es válido: si no existe, 404", async () => {
    await expect(w.staff.setActive(librarian.actor, "x".repeat(128), false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("active ausente: error de validación (400)", async () => {
    await expect(w.staff.setActive(librarian.actor, student.id, undefined)).rejects.toBeInstanceOf(ZodError);
    expect((await w.stored(student))?.active).toBe(true);
  });

  it("la validación va antes que el 404: id inexistente con cuerpo inválido da 400", async () => {
    await expect(w.staff.setActive(librarian.actor, "no-existe", undefined)).rejects.toBeInstanceOf(ZodError);
  });

  it("la validación va antes que la matriz: bibliotecario sobre el administrador con cuerpo inválido da 400", async () => {
    await expect(w.staff.setActive(librarian.actor, admin.id, undefined)).rejects.toBeInstanceOf(ZodError);
  });

  it("una cuenta inexistente da 404 «La cuenta no existe.»", async () => {
    const error = await rejectionOf(w.staff.setActive(librarian.actor, "no-existe", false));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe("La cuenta no existe.");
  });

  it("el 404 va antes que la matriz: el administrador sobre un id inexistente da 404, no 403", async () => {
    await expect(w.staff.setActive(admin.actor, "no-existe", false)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("F14 · idempotencia (regla 9)", () => {
  it("pedir active=false a una cuenta ya inactiva devuelve la cuenta y no escribe", async () => {
    const inactive = await w.addWithState("ESTUDIANTE", false);
    const write = vi.spyOn(w.repos.members, "setActive");

    const result = await w.staff.setActive(librarian.actor, inactive.id, false);

    expect(result).toMatchObject({ id: inactive.id, active: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("pedir active=true a una cuenta que nunca se desactivó devuelve la cuenta y no escribe", async () => {
    const write = vi.spyOn(w.repos.members, "setActive");

    const result = await w.staff.setActive(librarian.actor, student.id, true);

    expect(result).toMatchObject({ id: student.id, active: true });
    expect(write).not.toHaveBeenCalled();
  });

  it("un cambio real sí escribe una sola vez", async () => {
    const write = vi.spyOn(w.repos.members, "setActive");

    await w.staff.setActive(librarian.actor, student.id, false);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(student.id, false);
  });

  it("repetir el mismo cambio dos veces deja la cuenta inactiva y ambas respuestas son correctas", async () => {
    const first = await w.staff.setActive(librarian.actor, student.id, false);
    const second = await w.staff.setActive(librarian.actor, student.id, false);

    expect(first).toEqual(second);
    expect(second.active).toBe(false);
  });

  it("la matriz va antes que la idempotencia: un bibliotecario sobre otro bibliotecario recibe 403 aunque ya tenga ese estado", async () => {
    const other = await w.addPerson("BIBLIOTECARIO");
    const write = vi.spyOn(w.repos.members, "setActive");

    await expect(w.staff.setActive(librarian.actor, other.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("F14 · qué se escribe (regla 11) y qué se devuelve", () => {
  it("solo cambia el campo active: nombre, correo y rol quedan iguales", async () => {
    const before = await w.stored(student);

    await w.staff.setActive(librarian.actor, student.id, false);

    expect(await w.stored(student)).toEqual({ ...before, active: false });
  });

  it("no toca a las demás cuentas", async () => {
    const others = [librarian, admin];
    const before = await Promise.all(others.map((person) => w.stored(person)));

    await w.staff.setActive(librarian.actor, student.id, false);

    expect(await Promise.all(others.map((person) => w.stored(person)))).toEqual(before);
  });

  it("devuelve el Member público (sin contraseña ni campos internos)", async () => {
    const result = await w.staff.setActive(admin.actor, student.id, false);

    expect(MemberSchema.strict().parse(result)).toEqual({
      id: student.id,
      name: student.name,
      email: student.email,
      role: "ESTUDIANTE",
      active: false,
    });
  });

  it("reactivar devuelve el acceso con el mismo rol", async () => {
    const teacher = await w.addPerson("DOCENTE");
    await w.staff.setActive(librarian.actor, teacher.id, false);

    const result = await w.staff.setActive(librarian.actor, teacher.id, true);

    expect(result).toMatchObject({ role: "DOCENTE", active: true });
  });

  it("desactivar a un DOCENTE funciona y conserva el rol", async () => {
    const teacher = await w.addPerson("DOCENTE");

    expect(await w.staff.setActive(librarian.actor, teacher.id, false)).toMatchObject({
      role: "DOCENTE",
      active: false,
    });
  });
});

describe("F14 · dos cambios simultáneos opuestos", () => {
  it("ambos terminan bien y la cuenta queda en el estado que devolvió uno de ellos", async () => {
    const outcomes = await Promise.allSettled([
      w.staff.setActive(librarian.actor, student.id, false),
      w.staff.setActive(admin.actor, student.id, true),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    const finalState = (await w.stored(student))?.active;
    const answers = outcomes.flatMap((outcome) => {
      if (outcome.status === "fulfilled") {
        return [outcome.value.active];
      }
      return [];
    });
    expect(answers).toContain(finalState);
  });
});

describe("F14 · la cuenta cambia entre la lectura y la escritura", () => {
  it("si el destino desaparece justo antes de escribir: 404", async () => {
    vi.spyOn(w.repos.members, "setActive").mockResolvedValue(undefined);

    await expect(w.staff.setActive(librarian.actor, student.id, false)).rejects.toBeInstanceOf(NotFoundError);
  });
});
