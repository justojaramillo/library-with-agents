import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryMemberRepository } from "../server/repository.memory";
import type { MemberRecord, MemberRepository } from "../server/repository";

let repo: MemberRepository;

beforeEach(() => {
  repo = createMemoryMemberRepository();
});

function record(id: string, name: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return { id, name, email: `${id}@example.com`, role: "ESTUDIANTE", active: true, ...over };
}

describe("F14 · MemberRepository.setActive (memoria)", () => {
  it("cambia solo el campo active y devuelve la cuenta ya actualizada", async () => {
    await repo.create(record("a", "Ana", { role: "DOCENTE" }));

    const updated = await repo.setActive("a", false);

    expect(updated).toEqual({ id: "a", name: "Ana", email: "a@example.com", role: "DOCENTE", active: false });
    expect(await repo.findById("a")).toEqual(updated);
  });

  it("reactiva una cuenta inactiva", async () => {
    await repo.create(record("a", "Ana", { active: false }));

    expect((await repo.setActive("a", true))?.active).toBe(true);
    expect((await repo.findById("a"))?.active).toBe(true);
  });

  it("pedir el estado que ya tiene no falla y deja la cuenta igual", async () => {
    await repo.create(record("a", "Ana"));

    expect(await repo.setActive("a", true)).toEqual(record("a", "Ana"));
  });

  it("una cuenta inexistente devuelve undefined y no crea nada", async () => {
    expect(await repo.setActive("no-existe", false)).toBeUndefined();
    expect(await repo.findById("no-existe")).toBeUndefined();
  });

  it("no toca a las demás cuentas", async () => {
    await repo.create(record("a", "Ana"));
    await repo.create(record("b", "Beto"));

    await repo.setActive("a", false);

    expect(await repo.findById("b")).toEqual(record("b", "Beto"));
  });

  it("devuelve una copia: modificarla no cambia lo guardado", async () => {
    await repo.create(record("a", "Ana"));
    const updated = await repo.setActive("a", false);
    if (updated === undefined) {
      throw new Error("la cuenta debía existir");
    }

    updated.name = "Alterada";

    expect((await repo.findById("a"))?.name).toBe("Ana");
  });

  it("la cuenta desactivada ya no sale entre las prestables de la búsqueda, pero sí entre las demás", async () => {
    await repo.create(record("a", "Ana Prueba"));
    await repo.setActive("a", false);

    expect((await repo.search("ana", 10, true)).members).toEqual([]);
    expect((await repo.search("ana", 10, false)).members.map((member) => member.id)).toEqual(["a"]);
  });
});

describe("F13 · MemberRepository.listByRoles (memoria)", () => {
  it("sin cuentas devuelve una lista vacía", async () => {
    expect(await repo.listByRoles(["BIBLIOTECARIO", "ADMINISTRADOR"], 200)).toEqual([]);
  });

  it("devuelve solo las cuentas con alguno de los roles pedidos", async () => {
    await repo.create(record("a", "Ana", { role: "BIBLIOTECARIO" }));
    await repo.create(record("b", "Beto", { role: "ADMINISTRADOR" }));
    await repo.create(record("c", "Carla", { role: "ESTUDIANTE" }));
    await repo.create(record("d", "Diego", { role: "DOCENTE" }));
    await repo.create(record("e", "Eva", { role: "EXTERNO" }));

    const found = await repo.listByRoles(["BIBLIOTECARIO", "ADMINISTRADOR"], 200);

    expect(found.map((member) => member.id)).toEqual(["a", "b"]);
  });

  it("un solo rol filtra solo ese rol", async () => {
    await repo.create(record("a", "Ana", { role: "BIBLIOTECARIO" }));
    await repo.create(record("b", "Beto", { role: "ADMINISTRADOR" }));

    expect((await repo.listByRoles(["ADMINISTRADOR"], 10)).map((member) => member.id)).toEqual(["b"]);
  });

  it("una lista de roles vacía no devuelve nada", async () => {
    await repo.create(record("a", "Ana"));

    expect(await repo.listByRoles([], 10)).toEqual([]);
  });

  it("incluye las cuentas inactivas", async () => {
    await repo.create(record("a", "Ana", { role: "BIBLIOTECARIO", active: false }));

    expect((await repo.listByRoles(["BIBLIOTECARIO"], 10)).map((member) => member.active)).toEqual([false]);
  });

  it("ordena por nombre en español (sin tildes ni mayúsculas) y luego por id", async () => {
    await repo.create(record("3", "Ñandú", { role: "BIBLIOTECARIO" }));
    await repo.create(record("2", "nora", { role: "BIBLIOTECARIO" }));
    await repo.create(record("1", "Álvaro", { role: "BIBLIOTECARIO" }));
    await repo.create(record("5", "Zoe", { role: "BIBLIOTECARIO" }));
    await repo.create(record("4", "Zoe", { role: "BIBLIOTECARIO" }));

    const found = await repo.listByRoles(["BIBLIOTECARIO"], 10);

    expect(found.map((member) => member.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("respeta el límite: devuelve las primeras del orden", async () => {
    for (const letter of ["d", "a", "c", "b"]) {
      await repo.create(record(letter, letter.toUpperCase(), { role: "BIBLIOTECARIO" }));
    }

    expect((await repo.listByRoles(["BIBLIOTECARIO"], 2)).map((member) => member.id)).toEqual(["a", "b"]);
    expect((await repo.listByRoles(["BIBLIOTECARIO"], 4)).map((member) => member.id)).toEqual(["a", "b", "c", "d"]);
    expect((await repo.listByRoles(["BIBLIOTECARIO"], 5)).map((member) => member.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("devuelve copias: modificarlas no cambia lo guardado", async () => {
    await repo.create(record("a", "Ana", { role: "BIBLIOTECARIO" }));
    const [first] = await repo.listByRoles(["BIBLIOTECARIO"], 10);
    if (first === undefined) {
      throw new Error("debía haber una cuenta");
    }

    first.active = false;

    expect((await repo.findById("a"))?.active).toBe(true);
  });
});
