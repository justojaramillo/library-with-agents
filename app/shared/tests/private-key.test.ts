import { describe, expect, it } from "vitest";
import { EnvChecker, type EnvSource, normalizePrivateKey } from "@/shared/server/env";

/** Claves FALSAS: solo tienen la forma de un PEM, no son claves reales. */
const REAL_BREAKS = "-----BEGIN PRIVATE KEY-----\nCLAVE-FALSA-ABC\n-----END PRIVATE KEY-----\n";
const LITERAL_BREAKS = "-----BEGIN PRIVATE KEY-----\\nCLAVE-FALSA-ABC\\n-----END PRIVATE KEY-----\\n";

describe("Clave privada · normalización", () => {
  it("quita las comillas dobles que envuelven todo el valor", () => {
    expect(normalizePrivateKey(`"${REAL_BREAKS}"`)).toBe(REAL_BREAKS);
  });

  it("quita las comillas simples que envuelven todo el valor", () => {
    expect(normalizePrivateKey(`'${REAL_BREAKS}'`)).toBe(REAL_BREAKS);
  });

  it("convierte los \\n literales en saltos de línea reales", () => {
    expect(normalizePrivateKey(LITERAL_BREAKS)).toBe(REAL_BREAKS);
  });

  it("quita las comillas y convierte los \\n literales en el mismo valor", () => {
    expect(normalizePrivateKey(`"${LITERAL_BREAKS}"`)).toBe(REAL_BREAKS);
    expect(normalizePrivateKey(`'${LITERAL_BREAKS}'`)).toBe(REAL_BREAKS);
  });

  it("deja igual un valor que ya tiene saltos de línea reales", () => {
    expect(normalizePrivateKey(REAL_BREAKS.trim())).toBe(REAL_BREAKS.trim());
  });

  it("recorta los espacios alrededor", () => {
    expect(normalizePrivateKey(`   ${REAL_BREAKS.trim()}   `)).toBe(REAL_BREAKS.trim());
  });

  it("recorta los espacios antes de buscar las comillas envolventes", () => {
    expect(normalizePrivateKey(`  "${LITERAL_BREAKS}"  `)).toBe(REAL_BREAKS);
  });

  it("un valor sin comillas solo cambia por los \\n literales", () => {
    expect(normalizePrivateKey("CLAVE-FALSA-SIN-COMILLAS")).toBe("CLAVE-FALSA-SIN-COMILLAS");
  });

  it("no quita comillas que solo aparecen al inicio", () => {
    expect(normalizePrivateKey('"CLAVE-FALSA')).toBe('"CLAVE-FALSA');
  });

  it("no quita comillas que solo aparecen al final", () => {
    expect(normalizePrivateKey('CLAVE-FALSA"')).toBe('CLAVE-FALSA"');
  });

  it("no quita comillas de tipos distintos al inicio y al final", () => {
    expect(normalizePrivateKey(`"CLAVE-FALSA'`)).toBe(`"CLAVE-FALSA'`);
  });

  it("quita una sola pareja de comillas, no todas", () => {
    expect(normalizePrivateKey('""CLAVE-FALSA""')).toBe('"CLAVE-FALSA"');
  });

  it("un valor vacío o de solo espacios queda vacío", () => {
    expect(normalizePrivateKey("")).toBe("");
    expect(normalizePrivateKey("   ")).toBe("");
  });
});

describe("Clave privada · validación en el entorno", () => {
  const BASE: EnvSource = {
    FIREBASE_PROJECT_ID: "biblioteca-prueba",
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-abc@biblioteca-prueba.iam.gserviceaccount.com",
    NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaFalsaApiKey123456",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "biblioteca-prueba.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "biblioteca-prueba",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1234567890:1234567890:web:abcdef123456",
  };

  function problemNames(key: string): string[] {
    const env = new EnvChecker({ ...BASE, FIREBASE_PRIVATE_KEY: key });
    return env.problems().map((problem) => problem.name);
  }

  it("acepta una clave PEM con comillas dobles envolventes y \\n literales", () => {
    expect(problemNames(`"${LITERAL_BREAKS}"`)).not.toContain("FIREBASE_PRIVATE_KEY");
  });

  it("acepta una clave PEM con comillas simples envolventes y \\n literales", () => {
    expect(problemNames(`'${LITERAL_BREAKS}'`)).not.toContain("FIREBASE_PRIVATE_KEY");
  });

  it("el entorno completo con esa clave es válido", () => {
    const env = new EnvChecker({ ...BASE, FIREBASE_PRIVATE_KEY: `"${LITERAL_BREAKS}"` });
    expect(env.isValid()).toBe(true);
  });

  it("sigue rechazando un valor con comillas que no es una clave PEM", () => {
    expect(problemNames('"esto-no-es-una-clave"')).toContain("FIREBASE_PRIVATE_KEY");
  });
});
