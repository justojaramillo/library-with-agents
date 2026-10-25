import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/shared/schema";
import { ForbiddenError } from "@/shared/server/errors";
import { makeStaffWorld, type StaffPerson, type StaffWorld } from "@/tests/helpers/staff";
import { MemberSchema } from "../schema";
import type { MemberRecord } from "../server/repository";

const LIST_MESSAGE = "Solo el administrador ve el personal.";

let w: StaffWorld;
let admin: StaffPerson;

beforeEach(async () => {
  w = makeStaffWorld();
  admin = await w.addPerson("ADMINISTRADOR", { name: "Administradora Única" });
});

function record(id: string, name: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return { id, name, email: `${id}@example.com`, role: "BIBLIOTECARIO", active: true, ...over };
}

async function addLibrarians(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await w.repos.members.create(record(`bib-${String(i).padStart(3, "0")}`, `Persona ${String(i).padStart(3, "0")}`));
  }
}

async function namesListed(): Promise<string[]> {
  return (await w.staff.list(admin.actor)).map((member) => member.name);
}

describe("F13 · listado de personal · autorización (regla 12)", () => {
  it.each([
    "BIBLIOTECARIO",
    "EXTERNO",
    "ESTUDIANTE",
    "DOCENTE",
  ] satisfies Role[])("un %s recibe 403 «Solo el administrador ve el personal.»", async (role) => {
    const actor = await w.addPerson(role);

    await expect(w.staff.list(actor.actor)).rejects.toThrow(new ForbiddenError(LIST_MESSAGE));
    await expect(w.staff.list(actor.actor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el administrador puede listar", async () => {
    await expect(w.staff.list(admin.actor)).resolves.toHaveLength(1);
  });
});

describe("F13 · listado de personal · contenido y bordes (regla 12)", () => {
  it("sin bibliotecarios: solo aparece el administrador", async () => {
    const listed = await w.staff.list(admin.actor);

    expect(listed.map((member) => member.id)).toEqual([admin.id]);
    expect(listed[0]).toMatchObject({ role: "ADMINISTRADOR", active: true });
  });

  it("con 1 bibliotecario: aparecen los dos", async () => {
    const librarian = await w.addPerson("BIBLIOTECARIO", { name: "Beatriz Soto" });

    const listed = await w.staff.list(admin.actor);

    expect(listed.map((member) => member.id)).toEqual([admin.id, librarian.id]);
  });

  it("no incluye a EXTERNO, ESTUDIANTE ni DOCENTE", async () => {
    for (const role of ["EXTERNO", "ESTUDIANTE", "DOCENTE"] satisfies Role[]) {
      await w.addPerson(role);
    }

    const listed = await w.staff.list(admin.actor);

    expect(listed.every((member) => member.role === "BIBLIOTECARIO" || member.role === "ADMINISTRADOR")).toBe(true);
    expect(listed).toHaveLength(1);
  });

  it("incluye al personal inactivo, marcado como inactivo", async () => {
    const inactive = await w.addWithState("BIBLIOTECARIO", false);

    const listed = await w.staff.list(admin.actor);

    expect(listed.find((member) => member.id === inactive.id)?.active).toBe(false);
  });

  it("devuelve cuentas públicas (sin contraseña ni campos internos)", async () => {
    await w.addPerson("BIBLIOTECARIO");

    for (const member of await w.staff.list(admin.actor)) {
      expect(MemberSchema.strict().safeParse(member).success).toBe(true);
    }
  });

  it("con exactamente 200 cuentas de personal devuelve las 200", async () => {
    await addLibrarians(199);

    expect(await w.staff.list(admin.actor)).toHaveLength(200);
  });

  it("con 201 cuentas de personal se corta en 200", async () => {
    await addLibrarians(200);

    expect(await w.staff.list(admin.actor)).toHaveLength(200);
  });

  it("con más de 200 sigue cortando en 200 aunque haya muchas más", async () => {
    await addLibrarians(260);

    expect(await w.staff.list(admin.actor)).toHaveLength(200);
  });
});

describe("F13 · listado de personal · orden por nombre en español y luego id", () => {
  it("ordena sin distinguir mayúsculas ni tildes, con la Ñ después de la N", async () => {
    const names = ["zoe", "Ñoño", "Óscar", "Nora", "Olga", "Ángela", "Ana", "bruno", "Carlos", "Beatriz"];
    for (const [index, name] of names.entries()) {
      await w.repos.members.create(record(`id-${index}`, name));
    }

    expect(await namesListed()).toEqual([
      "Administradora Única",
      "Ana",
      "Ángela",
      "Beatriz",
      "bruno",
      "Carlos",
      "Nora",
      "Ñoño",
      "Olga",
      "Óscar",
      "zoe",
    ]);
  });

  it("a igual nombre, ordena por id", async () => {
    await w.repos.members.create(record("b-id", "Mismo Nombre"));
    await w.repos.members.create(record("a-id", "Mismo Nombre"));
    await w.repos.members.create(record("c-id", "Mismo Nombre"));

    const listed = await w.staff.list(admin.actor);

    expect(listed.filter((member) => member.name === "Mismo Nombre").map((member) => member.id)).toEqual([
      "a-id",
      "b-id",
      "c-id",
    ]);
  });

  it("mezcla administrador y bibliotecarios en un solo orden por nombre", async () => {
    await w.repos.members.create(record("z", "Zacarías"));
    await w.repos.members.create(record("a", "Aaron"));

    expect(await namesListed()).toEqual(["Aaron", "Administradora Única", "Zacarías"]);
  });

  it("con más de 200 devuelve las 200 primeras en ese orden", async () => {
    await addLibrarians(210);

    const names = await namesListed();

    expect(names).toHaveLength(200);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })));
    expect(names).not.toContain("Persona 209");
  });
});
