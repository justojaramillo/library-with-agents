import { describe, expect, it } from "vitest";
import { MemberSchema, SearchMembersQuerySchema, type SearchMembersQuery } from "../schema";
import { buildSearchKeys, matchesMemberQuery, normalizeWords } from "../server/member-search";
import type { MemberRecord } from "../server/repository";
import { aProvisionedMember, makeWorld } from "@/tests/helpers/factories";
import type { Role } from "@/shared/schema";

let seq = 0;
function record(name: string, over: Partial<MemberRecord> = {}): MemberRecord {
  seq += 1;
  return { id: `s-${seq}`, name, email: `cuenta${seq}@example.com`, role: "ESTUDIANTE", active: true, ...over };
}

function query(q: string, over: Partial<SearchMembersQuery> = {}): SearchMembersQuery {
  return { q, limit: 10, lendable: false, ...over };
}

describe("B1 · normalizeWords", () => {
  it("pasa a minúsculas, quita tildes y separa en palabras", () => {
    expect(normalizeWords("María Pérez")).toEqual(["maria", "perez"]);
  });

  it("las mayúsculas no importan", () => {
    expect(normalizeWords("JOSE")).toEqual(["jose"]);
    expect(normalizeWords("José")).toEqual(["jose"]);
  });

  it("separa por cualquier carácter que no sea letra o dígito", () => {
    expect(normalizeWords("maria.perez@example.com")).toEqual(["maria", "perez", "example", "com"]);
    expect(normalizeWords("a-b_c  d,e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("los dígitos cuentan como parte de las palabras", () => {
    expect(normalizeWords("Ana 2do")).toEqual(["ana", "2do"]);
  });

  it("un texto vacío o solo de símbolos no tiene palabras", () => {
    expect(normalizeWords("")).toEqual([]);
    expect(normalizeWords("  ")).toEqual([]);
    expect(normalizeWords("!!! --- @@@")).toEqual([]);
  });
});

describe("B1 · matchesMemberQuery", () => {
  const maria = record("María Pérez", { email: "mperez@example.com" });
  const pedro = record("Pedro Martínez", { email: "pedro.martinez@example.com" });

  it("cada palabra de q debe ser el comienzo de alguna palabra del nombre: «mar per» encuentra a María Pérez", () => {
    expect(matchesMemberQuery(maria, "mar per")).toBe(true);
  });

  it("«mar» encuentra a ambos (por «María» y por «Martínez»); «per» solo a María Pérez; «ería» a ninguno", () => {
    expect(matchesMemberQuery(maria, "mar")).toBe(true);
    expect(matchesMemberQuery(pedro, "mar")).toBe(true);
    expect(matchesMemberQuery(maria, "per")).toBe(true);
    expect(matchesMemberQuery(pedro, "per")).toBe(false);
    expect(matchesMemberQuery(maria, "ería")).toBe(false);
    expect(matchesMemberQuery(pedro, "ería")).toBe(false);
  });

  it("solo coincide con el comienzo de la palabra, no con el medio ni el final", () => {
    expect(matchesMemberQuery(maria, "rez")).toBe(false);
    expect(matchesMemberQuery(maria, "aria")).toBe(false);
  });

  it("las palabras de q pueden ir en cualquier orden", () => {
    expect(matchesMemberQuery(maria, "per mar")).toBe(true);
  });

  it("si una sola palabra de q no coincide con nada, la cuenta no coincide", () => {
    expect(matchesMemberQuery(maria, "mar zzz")).toBe(false);
  });

  it("no distingue mayúsculas ni tildes, en ninguno de los dos lados", () => {
    const jose = record("José Álvarez");
    expect(matchesMemberQuery(jose, "JOSE")).toBe(true);
    expect(matchesMemberQuery(jose, "jóse")).toBe(true);
    expect(matchesMemberQuery(jose, "alvarez")).toBe(true);
    expect(matchesMemberQuery(jose, "ÁLV")).toBe(true);
  });

  it("también busca en la parte del correo anterior a @", () => {
    const juan = record("Juan Gómez", { email: "jgomez.docente@example.com" });
    expect(matchesMemberQuery(juan, "docente")).toBe(true);
    expect(matchesMemberQuery(juan, "jgo")).toBe(true);
    expect(matchesMemberQuery(juan, "jgomez.docente@")).toBe(true);
  });

  it("no busca en el dominio del correo", () => {
    const juan = record("Juan Gómez", { email: "jgomez@universidad.edu.co" });
    expect(matchesMemberQuery(juan, "universidad")).toBe(false);
  });

  it("cada palabra de q puede apoyarse en una parte distinta: nombre y correo", () => {
    const ana = record("Ana Ruiz", { email: "aruiz.mat@example.com" });
    expect(matchesMemberQuery(ana, "ana mat")).toBe(true);
  });

  it("el rol y el estado no cambian la coincidencia (eso lo decide el filtro lendable)", () => {
    const inactive = record("María Pérez", { active: false, role: "BIBLIOTECARIO" });
    expect(matchesMemberQuery(inactive, "mar")).toBe(true);
  });
});

describe("B4 · buildSearchKeys", () => {
  it("incluye los prefijos de 2 o más letras de cada palabra del nombre, sin tildes", () => {
    const keys = buildSearchKeys("María Pérez", "mperez@example.com");

    expect(keys).toEqual(expect.arrayContaining(["ma", "mar", "mari", "maria", "pe", "per", "pere", "perez"]));
  });

  it("no incluye prefijos de una sola letra", () => {
    const keys = buildSearchKeys("María Pérez", "mperez@example.com");

    expect(keys).not.toContain("m");
    expect(keys).not.toContain("p");
  });

  it("las palabras de una sola letra no aportan ninguna clave", () => {
    const keys = buildSearchKeys("A B", "x@example.com");

    expect(keys).not.toContain("a");
    expect(keys).not.toContain("b");
    expect(keys.every((key) => key.length >= 2)).toBe(true);
  });

  it("una palabra de exactamente 2 letras aporta su clave", () => {
    expect(buildSearchKeys("Al Li", "x@example.com")).toEqual(expect.arrayContaining(["al", "li"]));
  });

  it("las claves están normalizadas: minúsculas y sin tildes", () => {
    const keys = buildSearchKeys("JOSÉ ÁLVAREZ", "x@example.com");

    expect(keys).toEqual(expect.arrayContaining(["jose", "alvarez", "al"]));
    for (const key of keys) {
      expect(key).toBe(key.toLowerCase());
      expect(key).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("incluye los prefijos de las palabras de la parte del correo anterior a @", () => {
    const keys = buildSearchKeys("Ana", "jgomez.docente@example.com");

    expect(keys).toEqual(expect.arrayContaining(["jg", "jgomez", "do", "docente"]));
  });

  it("los prefijos llegan hasta 20 letras: 20 sí, 21 no", () => {
    const longWord = "abcdefghijklmnopqrstuvwxyz"; // 26 letras
    const keys = buildSearchKeys(longWord, "x@example.com");

    expect(keys).toContain(longWord.slice(0, 20));
    expect(keys).toContain(longWord.slice(0, 19));
    expect(keys).not.toContain(longWord.slice(0, 21));
    expect(keys).not.toContain(longWord);
  });

  it("una palabra de exactamente 20 letras queda completa como clave", () => {
    const word = "abcdefghijklmnopqrst";

    expect(buildSearchKeys(word, "x@example.com")).toContain(word);
  });

  it("toda palabra que acepta la búsqueda tiene su clave: la consulta por la palabra más larga la encuentra", () => {
    const keys = buildSearchKeys("María Pérez", "mperez@example.com");

    for (const word of normalizeWords("mar per")) {
      expect(keys).toContain(word);
    }
  });
});

describe("Esquema de la consulta: SearchMembersQuerySchema (bordes de q, limit y lendable)", () => {
  const parse = (input: { q: string; limit?: string; lendable?: string }) => SearchMembersQuerySchema.safeParse(input);

  it("q de 1 carácter se rechaza; de 2 y de 100 se aceptan; de 101 se rechaza", () => {
    expect(parse({ q: "a" }).success).toBe(false);
    expect(parse({ q: "ab" }).success).toBe(true);
    expect(parse({ q: "a".repeat(100) }).success).toBe(true);
    expect(parse({ q: "a".repeat(101) }).success).toBe(false);
  });

  it("q solo de símbolos o sin ninguna palabra de 2 o más letras se rechaza", () => {
    expect(parse({ q: "!!" }).success).toBe(false);
    expect(parse({ q: "a b" }).success).toBe(false);
  });

  it("limit va de 1 a 20 (por defecto 10) y lendable por defecto es false", () => {
    expect(parse({ q: "ana" })).toMatchObject({ success: true, data: { limit: 10, lendable: false } });
    expect(parse({ q: "ana", limit: "1" }).success).toBe(true);
    expect(parse({ q: "ana", limit: "20" }).success).toBe(true);
    expect(parse({ q: "ana", limit: "0" }).success).toBe(false);
    expect(parse({ q: "ana", limit: "21" }).success).toBe(false);
    expect(parse({ q: "ana", lendable: "true" })).toMatchObject({ success: true, data: { lendable: true } });
  });
});

describe("B2 · MemberRepository.search (en memoria)", () => {
  async function repoWith(records: MemberRecord[]) {
    const { repos } = makeWorld();
    for (const item of records) {
      await repos.members.create(item);
    }
    return repos.members;
  }

  it("encuentra por prefijos de palabra del nombre: «mar per» → María Pérez", async () => {
    const members = await repoWith([record("María Pérez"), record("Pedro Martínez"), record("Luis Soto")]);

    const found = await members.search("mar per", 10, false);

    expect(found.map((member) => member.name)).toEqual(["María Pérez"]);
  });

  it("«mar» trae a María Pérez y a Pedro Martínez; «ería» a ninguno", async () => {
    const members = await repoWith([record("María Pérez"), record("Pedro Martínez"), record("Luis Soto")]);

    expect((await members.search("mar", 10, false)).map((member) => member.name).sort()).toEqual([
      "María Pérez",
      "Pedro Martínez",
    ]);
    await expect(members.search("ería", 10, false)).resolves.toEqual([]);
  });

  it("«JOSE» encuentra a «José»", async () => {
    const members = await repoWith([record("José Díaz"), record("Luis Soto")]);

    expect((await members.search("JOSE", 10, false)).map((member) => member.name)).toEqual(["José Díaz"]);
  });

  it("encuentra por la parte del correo anterior a @", async () => {
    const members = await repoWith([record("Luis Soto", { email: "lsoto.biblio@example.com" })]);

    expect(await members.search("biblio", 10, false)).toHaveLength(1);
    expect(await members.search("example", 10, false)).toHaveLength(0);
  });

  it("sin coincidencias devuelve una lista vacía", async () => {
    const members = await repoWith([record("Luis Soto")]);

    await expect(members.search("zzz", 10, false)).resolves.toEqual([]);
  });

  it("ordena por nombre en orden español, no por código de carácter", async () => {
    const members = await repoWith([
      record("Zulema Díaz"),
      record("Álvaro Díaz"),
      record("Alberto Díaz"),
      record("Beatriz Díaz"),
    ]);

    const found = await members.search("diaz", 10, false);

    expect(found.map((member) => member.name)).toEqual(["Alberto Díaz", "Álvaro Díaz", "Beatriz Díaz", "Zulema Díaz"]);
  });

  it("el orden por nombre no depende del orden en que se crearon las cuentas", async () => {
    const names = ["Carla Ruiz", "Ana Ruiz", "Bruno Ruiz"];
    const forward = await repoWith(names.map((name) => record(name)));
    const backward = await repoWith([...names].reverse().map((name) => record(name)));

    expect((await forward.search("ruiz", 10, false)).map((member) => member.name)).toEqual([
      "Ana Ruiz",
      "Bruno Ruiz",
      "Carla Ruiz",
    ]);
    expect((await backward.search("ruiz", 10, false)).map((member) => member.name)).toEqual([
      "Ana Ruiz",
      "Bruno Ruiz",
      "Carla Ruiz",
    ]);
  });

  it("dos personas con el mismo nombre salen las dos, distinguibles por el correo", async () => {
    const members = await repoWith([
      record("Ana Gómez", { email: "ana.gomez1@example.com" }),
      record("Ana Gómez", { email: "ana.gomez2@example.com" }),
    ]);

    const found = await members.search("ana gomez", 10, false);

    expect(found.map((member) => member.email).sort()).toEqual(["ana.gomez1@example.com", "ana.gomez2@example.com"]);
  });

  describe("limit", () => {
    async function manyLectores(count: number) {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const created = [...letters.slice(0, count)].map((letter) => record(`Lector ${letter}`));
      return repoWith([...created].reverse());
    }

    it("limit 1 devuelve solo la primera por nombre, aunque se haya creado la última", async () => {
      const members = await manyLectores(3);

      expect((await members.search("lector", 1, false)).map((member) => member.name)).toEqual(["Lector A"]);
    });

    it("limit 20 con 21 coincidencias devuelve las 20 primeras por nombre", async () => {
      const members = await manyLectores(21);

      const found = await members.search("lector", 20, false);

      expect(found).toHaveLength(20);
      expect(found[0].name).toBe("Lector A");
      expect(found[19].name).toBe("Lector T");
    });

    it("con menos coincidencias que el límite devuelve solo las que hay", async () => {
      const members = await manyLectores(2);

      expect(await members.search("lector", 20, false)).toHaveLength(2);
    });

    it("el límite se aplica después de filtrar con lendable", async () => {
      const members = await repoWith([
        record("Aaron Prueba", { active: false }),
        record("Beto Prueba"),
        record("Carla Prueba"),
      ]);

      const found = await members.search("prueba", 1, true);

      expect(found.map((member) => member.name)).toEqual(["Beto Prueba"]);
    });
  });

  describe("lendable", () => {
    async function mixed() {
      return repoWith([
        record("Prueba Externo", { role: "EXTERNO" }),
        record("Prueba Estudiante", { role: "ESTUDIANTE" }),
        record("Prueba Docente", { role: "DOCENTE" }),
        record("Prueba Bibliotecario", { role: "BIBLIOTECARIO" }),
        record("Prueba Administrador", { role: "ADMINISTRADOR" }),
        record("Prueba Inactiva", { role: "ESTUDIANTE", active: false }),
        record("Prueba Docente Inactivo", { role: "DOCENTE", active: false }),
      ]);
    }

    it("con lendable = true solo salen cuentas activas con rol de prestatario (incluido DOCENTE)", async () => {
      const members = await mixed();

      const found = await members.search("prueba", 20, true);

      expect(found.map((member) => member.name)).toEqual(["Prueba Docente", "Prueba Estudiante", "Prueba Externo"]);
      const roles: Role[] = found.map((member) => member.role);
      expect(roles).not.toContain("BIBLIOTECARIO");
      expect(roles).not.toContain("ADMINISTRADOR");
      expect(found.every((member) => member.active)).toBe(true);
    });

    it("con lendable = false salen todas: personal e inactivas incluidas", async () => {
      const members = await mixed();

      const found = await members.search("prueba", 20, false);

      expect(found).toHaveLength(7);
    });

    it("una cuenta que solo es de personal o inactiva no aparece con lendable = true aunque sea la única coincidencia", async () => {
      const members = await repoWith([
        record("Zeta Personal", { role: "BIBLIOTECARIO" }),
        record("Zeta Inactiva", { active: false }),
      ]);

      await expect(members.search("zeta", 10, true)).resolves.toEqual([]);
    });
  });
});

describe("MemberService.search", () => {
  function expectPublicShape(found: object[]) {
    for (const member of found) {
      expect(Object.keys(member).sort()).toEqual(["active", "email", "id", "name", "role"]);
      expect(MemberSchema.safeParse(member).success).toBe(true);
    }
  }

  it("devuelve cuentas públicas sin el campo interno search_keys", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ name: "María Pérez", email: "maria.perez@example.com" }));
    await members.provision(aProvisionedMember({ name: "Pedro Martínez", role: "DOCENTE" }));

    const found = await members.search(query("mar"));

    expect(found.map((member) => member.name)).toEqual(["María Pérez", "Pedro Martínez"]);
    expectPublicShape(found);
    expect(JSON.stringify(found)).not.toContain("search_keys");
  });

  it("aplica limit y lendable", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ name: "Prueba Uno", role: "ESTUDIANTE" }));
    await members.provision(aProvisionedMember({ name: "Prueba Dos", role: "DOCENTE" }));
    await members.provision(aProvisionedMember({ name: "Prueba Tres", role: "BIBLIOTECARIO" }));

    expect((await members.search(query("prueba", { lendable: true }))).map((member) => member.name)).toEqual([
      "Prueba Dos",
      "Prueba Uno",
    ]);
    expect((await members.search(query("prueba", { limit: 1 }))).map((member) => member.name)).toEqual(["Prueba Dos"]);
  });

  it("una cuenta recién creada se encuentra de inmediato por nombre y por correo", async () => {
    const { members } = makeWorld();
    const created = await members.provision(
      aProvisionedMember({ name: "Gabriela Núñez", email: "gnunez.lectora@example.com" }),
    );

    expect((await members.search(query("gabri"))).map((member) => member.id)).toEqual([created.id]);
    expect((await members.search(query("lectora"))).map((member) => member.id)).toEqual([created.id]);
  });

  it("sin coincidencias devuelve una lista vacía", async () => {
    const { members } = makeWorld();
    await members.provision(aProvisionedMember({ name: "Luis Soto" }));

    await expect(members.search(query("zzz"))).resolves.toEqual([]);
  });
});
