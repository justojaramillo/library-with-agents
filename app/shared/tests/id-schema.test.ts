import { describe, expect, it } from "vitest";
import { IdSchema } from "@/shared/schema";

const FIREBASE_UID = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";

describe("IdSchema · identificadores (ADR-0003)", () => {
  it.each([
    ["un id corto de Firestore", "abc123"],
    ["un uid de Firebase de 28 caracteres", FIREBASE_UID],
    ["un id de exactamente 128 caracteres (límite)", "a".repeat(128)],
    ["un solo carácter (límite inferior)", "x"],
    ["un guion bajo a cada lado (_a_)", "_a_"],
    ["un punto en medio (a.b)", "a.b"],
    ["un doble guion bajo en medio (a__b)", "a__b"],
    ["un guion bajo solo al inicio (_x)", "_x"],
    ["un guion bajo solo al final (x_)", "x_"],
    ["un doble guion bajo solo al inicio (__x)", "__x"],
    ["un doble guion bajo solo al final (x__)", "x__"],
    ["tres puntos (...)", "..."],
    ["un punto seguido de texto (.a)", ".a"],
    ["abc", "abc"],
  ])("acepta %s", (_name, id) => {
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it("el uid de prueba tiene 28 caracteres", () => {
    expect(FIREBASE_UID).toHaveLength(28);
  });

  it.each([
    ["el texto vacío", ""],
    ["un id con «/» en medio", "a/b"],
    ["un id que empieza con «/»", "/abc"],
    ["un id que termina con «/»", "abc/"],
    ["un id de 129 caracteres (límite + 1)", "a".repeat(129)],
    ["un punto solo («.»), reservado por Firestore", "."],
    ["dos puntos («..»), reservado por Firestore", ".."],
    ["la forma __x__, reservada por Firestore", "__x__"],
    ["la forma __abc123__, reservada por Firestore", "__abc123__"],
    ["cuatro guiones bajos (____)", "____"],
    ["un id reservado con «/»", "__x__/a"],
  ])("rechaza %s", (_name, id) => {
    expect(IdSchema.safeParse(id).success).toBe(false);
  });
});
