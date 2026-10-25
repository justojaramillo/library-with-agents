import { describe, expect, it } from "vitest";
import { SearchMembersQuerySchema } from "../schema";
import {
  buildSearchKeys,
  longestQueryWord,
  matchesMemberQuery,
  normalizeWords,
  queryWords,
} from "../server/member-search";
import { makeWorld } from "@/tests/helpers/factories";

const MATH_SCRIPT = "𝒜𝒷𝒸𝒹𝑒𝒻"; // 6 puntos de código fuera del plano básico (2 unidades UTF-16 cada uno)
const HAN = "𠮷"; // 1 punto de código, 2 unidades UTF-16
const EMAIL = "x@example.com";

const codePoints = (text: string): number => Array.from(text).length;

describe("B4 · buildSearchKeys con caracteres fuera del plano básico", () => {
  it("un nombre de 6 letras matemáticas produce claves bien formadas de 2 a 6 puntos de código", () => {
    const keys = buildSearchKeys(MATH_SCRIPT, EMAIL);
    const mine = keys.filter((key) => MATH_SCRIPT.startsWith(key));

    expect(mine.map(codePoints).sort()).toEqual([2, 3, 4, 5, 6]);
    for (const key of keys) {
      expect(key.isWellFormed()).toBe(true);
    }
  });

  it("cada prefijo es un prefijo real de la palabra, partido por puntos de código", () => {
    const keys = buildSearchKeys(MATH_SCRIPT, EMAIL);
    const chars = Array.from(MATH_SCRIPT);

    for (let size = 2; size <= chars.length; size += 1) {
      expect(keys).toContain(chars.slice(0, size).join(""));
    }
  });

  it("«𠮷𠮷𠮷» (3 puntos de código, 6 unidades) aporta claves de 2 y 3 puntos", () => {
    const keys = buildSearchKeys(HAN.repeat(3), EMAIL);

    expect(keys).toContain(HAN.repeat(2));
    expect(keys).toContain(HAN.repeat(3));
    for (const key of keys) {
      expect(key.isWellFormed()).toBe(true);
    }
  });

  it("una palabra de 25 puntos de código: llegan hasta 20 puntos, 21 no, y todo está bien formado", () => {
    const keys = buildSearchKeys(HAN.repeat(25), EMAIL);
    const han = keys.filter((key) => key.startsWith(HAN));
    const sizes = han.map(codePoints);

    expect(keys).toContain(HAN.repeat(20));
    expect(keys).not.toContain(HAN.repeat(21));
    expect(Math.max(...sizes)).toBe(20);
    expect(Math.min(...sizes)).toBe(2);
    for (const key of keys) {
      expect(key.isWellFormed()).toBe(true);
      expect(codePoints(key)).toBeGreaterThanOrEqual(2);
      expect(codePoints(key)).toBeLessThanOrEqual(20);
    }
  });

  it("una palabra de exactamente 20 puntos de código queda completa como clave; de 21 no", () => {
    expect(buildSearchKeys(HAN.repeat(20), EMAIL)).toContain(HAN.repeat(20));
    expect(buildSearchKeys(HAN.repeat(21), EMAIL)).not.toContain(HAN.repeat(21));
  });

  it("20 letras matemáticas (40 unidades UTF-16) también quedan completas", () => {
    const word = Array.from(MATH_SCRIPT.repeat(4)).slice(0, 20).join("");

    expect(codePoints(word)).toBe(20);
    expect(buildSearchKeys(word, EMAIL)).toContain(word);
  });

  it("no repite claves", () => {
    const keys = buildSearchKeys(`${HAN.repeat(5)} ${HAN.repeat(5)}`, EMAIL);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("mezcla de letras comunes y astrales: todas las claves bien formadas", () => {
    const keys = buildSearchKeys(`María ${MATH_SCRIPT} ${HAN.repeat(4)}`, "maria.perez@example.com");

    for (const key of keys) {
      expect(key.isWellFormed()).toBe(true);
    }
    expect(keys).toEqual(expect.arrayContaining(["maria", "perez", MATH_SCRIPT, HAN.repeat(4)]));
  });
});

describe("B4 · con letras normales y tildes el resultado no cambia", () => {
  it("«María Pérez» sigue dando los prefijos de siempre", () => {
    const keys = buildSearchKeys("María Pérez", "mperez@example.com");

    expect(keys).toEqual(
      expect.arrayContaining(["ma", "mar", "mari", "maria", "pe", "per", "pere", "perez", "mp", "mpe", "mper"]),
    );
    expect(keys).not.toContain("m");
  });

  it("una palabra de 26 letras: 20 sí, 21 no", () => {
    const word = "abcdefghijklmnopqrstuvwxyz";
    const keys = buildSearchKeys(word, EMAIL);

    expect(keys).toContain(word.slice(0, 20));
    expect(keys).not.toContain(word.slice(0, 21));
  });

  it("normalizeWords sigue quitando tildes y separando por símbolos", () => {
    expect(normalizeWords("José Álvarez-Ñandú")).toEqual(["jose", "alvarez", "nandu"]);
  });
});

describe("B1 · matchesMemberQuery por puntos de código", () => {
  const record = (name: string) => ({ name, email: EMAIL });

  it("encuentra un nombre astral por el comienzo de su palabra", () => {
    expect(matchesMemberQuery(record(MATH_SCRIPT), "𝒜𝒷")).toBe(true);
    expect(matchesMemberQuery(record(MATH_SCRIPT), "𝒜𝒷𝒸")).toBe(true);
    expect(matchesMemberQuery(record(MATH_SCRIPT), MATH_SCRIPT)).toBe(true);
  });

  it("no coincide por el medio de la palabra astral", () => {
    expect(matchesMemberQuery(record(MATH_SCRIPT), "𝒷𝒸")).toBe(false);
  });

  it("«𠮷𠮷» encuentra a «𠮷𠮷𠮷» pero «𠮷𠮷𠮷𠮷» no", () => {
    expect(matchesMemberQuery(record(HAN.repeat(3)), HAN.repeat(2))).toBe(true);
    expect(matchesMemberQuery(record(HAN.repeat(3)), HAN.repeat(4))).toBe(false);
  });

  it("un nombre de más de 20 puntos de código se encuentra con una consulta de 20 puntos", () => {
    expect(matchesMemberQuery(record(HAN.repeat(25)), HAN.repeat(20))).toBe(true);
  });

  it("una consulta con varias palabras mezcla letras comunes y astrales", () => {
    expect(
      matchesMemberQuery(record(`María ${MATH_SCRIPT}`), `mar ${Array.from(MATH_SCRIPT).slice(0, 2).join("")}`),
    ).toBe(true);
  });

  it("con letras normales y tildes el resultado no cambia", () => {
    const maria = record("María Pérez");

    expect(matchesMemberQuery(maria, "mar per")).toBe(true);
    expect(matchesMemberQuery(maria, "ERÍA")).toBe(false);
    expect(matchesMemberQuery(maria, "")).toBe(false);
  });
});

describe("B4 · la palabra más larga de q (la que se consulta con array-contains)", () => {
  it("con letras normales es la más larga, sin tildes", () => {
    expect(longestQueryWord("mar pérez")).toBe("perez");
    expect(queryWords("mar pérez")).toEqual(["mar", "perez"]);
  });

  it("una palabra de 25 puntos de código se trunca a 20 puntos y queda bien formada", () => {
    const longest = longestQueryWord(HAN.repeat(25));

    expect(codePoints(longest)).toBe(20);
    expect(longest).toBe(HAN.repeat(20));
    expect(longest.isWellFormed()).toBe(true);
  });

  it("con 25 letras matemáticas se trunca por puntos de código, no por unidades", () => {
    const word = Array.from(MATH_SCRIPT.repeat(5)).slice(0, 25).join("");
    const longest = longestQueryWord(word);

    expect(codePoints(longest)).toBe(20);
    expect(word.startsWith(longest)).toBe(true);
    expect(longest.isWellFormed()).toBe(true);
  });

  it("una palabra de 20 puntos de código no se recorta", () => {
    expect(longestQueryWord(HAN.repeat(20))).toBe(HAN.repeat(20));
  });

  it("entre una palabra astral corta en puntos pero larga en unidades y una BMP más larga en puntos, gana la de más puntos", () => {
    // «𠮷𠮷𠮷» mide 6 unidades UTF-16 pero 3 puntos; «abcd» mide 4 de ambos.
    expect(longestQueryWord(`${HAN.repeat(3)} abcd`)).toBe("abcd");
  });

  it("la consulta por la palabra más larga encuentra la clave guardada del nombre astral", () => {
    const keys = buildSearchKeys(HAN.repeat(25), EMAIL);

    expect(keys).toContain(longestQueryWord(HAN.repeat(25)));
    expect(keys).toContain(longestQueryWord(HAN.repeat(22)));
  });

  it("toda palabra aceptada de una consulta con letras astrales tiene su clave guardada", () => {
    const keys = buildSearchKeys(`Ana ${MATH_SCRIPT}`, EMAIL);

    expect(keys).toContain(longestQueryWord("𝒜𝒷𝒸 ana"));
  });
});

describe("B2 · el repositorio en memoria con nombres astrales", () => {
  it("encuentra a una persona de nombre astral y no revienta con la palabra larga de la consulta", async () => {
    const { repos } = makeWorld();
    await repos.members.create({
      id: "u-1",
      name: HAN.repeat(25),
      email: "han@example.com",
      role: "ESTUDIANTE",
      active: true,
    });
    await repos.members.create({
      id: "u-2",
      name: "Luis Soto",
      email: "luis@example.com",
      role: "ESTUDIANTE",
      active: true,
    });

    const found = await repos.members.search(HAN.repeat(22), 10, false);

    expect(found.map((member) => member.id)).toEqual(["u-1"]);
  });
});

describe("Esquema de la consulta con caracteres astrales", () => {
  it("acepta una consulta de letras astrales (son letras) y la rechaza si queda en una sola", () => {
    expect(SearchMembersQuerySchema.safeParse({ q: HAN.repeat(2) }).success).toBe(true);
    expect(SearchMembersQuerySchema.safeParse({ q: MATH_SCRIPT }).success).toBe(true);
    expect(SearchMembersQuerySchema.safeParse({ q: `${HAN} a` }).success).toBe(false);
  });
});
