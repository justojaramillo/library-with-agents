import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createMemoryMemberRepository } from "@/features/accounts/server/repository.memory";
import { aMember, aProvisionedMember, makeWorld } from "@/tests/helpers/factories";

/** `count` ids que no pertenecen a ninguna cuenta. */
function missingIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `no-existe-${i}`);
}

describe("F34–F35 · MemberService.getMany (lectura por lote)", () => {
  it("una lista vacía devuelve una lista vacía", async () => {
    const { members } = makeWorld();
    expect(await members.getMany([])).toEqual([]);
  });

  it("devuelve solo las cuentas pedidas, no todas", async () => {
    const { members } = makeWorld();
    const first = await members.register(aMember());
    await members.register(aMember());
    const third = await members.register(aMember());
    const found = await members.getMany([first.id, third.id]);
    expect(found.map((member) => member.id)).toEqual([first.id, third.id]);
  });

  it("devuelve la cuenta tal como la devuelve `get` (sin contraseña ni campos internos)", async () => {
    const { members } = makeWorld();
    const created = await members.provision(aProvisionedMember({ role: "DOCENTE" }));
    const [found] = await members.getMany([created.id]);
    expect(found).toEqual(await members.get(created.id));
    expect(found).toEqual(created);
    expect(Object.keys(found ?? {})).not.toContain("search_keys");
    expect(Object.keys(found ?? {})).not.toContain("password");
  });

  it("incluye también las cuentas de personal y las inactivas: es lectura por id, no búsqueda", async () => {
    const { members } = makeWorld();
    const librarian = await members.provision(aProvisionedMember({ role: "BIBLIOTECARIO" }));
    const student = await members.provision(aProvisionedMember({ role: "ESTUDIANTE" }));
    const found = await members.getMany([librarian.id, student.id]);
    expect(found.map((member) => member.role)).toEqual(["BIBLIOTECARIO", "ESTUDIANTE"]);
  });

  it("ignora los ids repetidos: cada cuenta sale una sola vez", async () => {
    const { members } = makeWorld();
    const member = await members.register(aMember());
    const found = await members.getMany([member.id, member.id, member.id]);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(member.id);
  });

  it("ignora los ids inexistentes sin fallar", async () => {
    const { members } = makeWorld();
    const member = await members.register(aMember());
    const found = await members.getMany(["no-existe", member.id, "tampoco"]);
    expect(found.map((item) => item.id)).toEqual([member.id]);
  });

  it("si ningún id existe devuelve una lista vacía", async () => {
    const { members } = makeWorld();
    expect(await members.getMany(["a", "b"])).toEqual([]);
  });

  it("conserva el orden de los ids recibidos, no el de creación", async () => {
    const { members } = makeWorld();
    const first = await members.register(aMember());
    const second = await members.register(aMember());
    const third = await members.register(aMember());
    const found = await members.getMany([third.id, first.id, second.id]);
    expect(found.map((member) => member.id)).toEqual([third.id, first.id, second.id]);
  });

  it("el orden se respeta aunque haya repetidos e inexistentes mezclados", async () => {
    const { members } = makeWorld();
    const first = await members.register(aMember());
    const second = await members.register(aMember());
    const found = await members.getMany([second.id, "no-existe", first.id, second.id]);
    expect(found.map((member) => member.id)).toEqual([second.id, first.id]);
  });

  describe("tope de 500 ids por llamada", () => {
    it("acepta exactamente 500 ids", async () => {
      const { members } = makeWorld();
      const member = await members.register(aMember());
      const found = await members.getMany([member.id, ...missingIds(499)]);
      expect(found.map((item) => item.id)).toEqual([member.id]);
    });

    it("rechaza 501 ids con un error de validación", async () => {
      const { members } = makeWorld();
      await expect(members.getMany(missingIds(501))).rejects.toThrow(ZodError);
    });

    it("500 ids repetidos de la misma cuenta no superan el tope y devuelven una", async () => {
      const { members } = makeWorld();
      const member = await members.register(aMember());
      const found = await members.getMany(Array.from({ length: 500 }, () => member.id));
      expect(found).toHaveLength(1);
    });
  });

  describe("ids con forma inválida", () => {
    it("rechaza un id vacío", async () => {
      const { members } = makeWorld();
      await expect(members.getMany([""])).rejects.toThrow(ZodError);
    });

    it("rechaza un id con «/»", async () => {
      const { members } = makeWorld();
      await expect(members.getMany(["cuentas/uno"])).rejects.toThrow(ZodError);
    });

    it("rechaza un id de más de 128 caracteres", async () => {
      const { members } = makeWorld();
      await expect(members.getMany(["x".repeat(129)])).rejects.toThrow(ZodError);
    });

    it("un solo id inválido entre ids válidos rechaza toda la llamada", async () => {
      const { members } = makeWorld();
      const member = await members.register(aMember());
      await expect(members.getMany([member.id, "a/b"])).rejects.toThrow(ZodError);
    });
  });
});

describe("F34–F35 · MemberRepository en memoria · findByIds", () => {
  const record = (id: string) => ({
    id,
    name: `Persona ${id}`,
    email: `${id}@example.com`,
    role: "ESTUDIANTE" as const,
    active: true,
  });

  it("devuelve solo las cuentas con esos ids", async () => {
    const repo = createMemoryMemberRepository();
    await repo.create(record("a"));
    await repo.create(record("b"));
    await repo.create(record("c"));
    const found = await repo.findByIds(["a", "c"]);
    expect(found.map((member) => member.id).sort()).toEqual(["a", "c"]);
  });

  it("una lista vacía devuelve una lista vacía", async () => {
    const repo = createMemoryMemberRepository();
    await repo.create(record("a"));
    expect(await repo.findByIds([])).toEqual([]);
  });

  it("ignora los ids inexistentes", async () => {
    const repo = createMemoryMemberRepository();
    await repo.create(record("a"));
    expect((await repo.findByIds(["a", "zzz"])).map((member) => member.id)).toEqual(["a"]);
  });

  it("devuelve copias: cambiar el resultado no altera el repositorio", async () => {
    const repo = createMemoryMemberRepository();
    await repo.create(record("a"));
    const [copy] = await repo.findByIds(["a"]);
    if (copy === undefined) {
      throw new Error("La cuenta debía existir");
    }
    copy.name = "Cambiado";
    expect((await repo.findById("a"))?.name).toBe("Persona a");
  });
});
