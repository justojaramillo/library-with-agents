import { describe, expect, it } from "vitest";
import { EnvChecker, type EnvSource } from "@/shared/server/env";

/** Valores de prueba, todos falsos y reconocibles para comprobar que nunca salen en el informe. */
const VALID: EnvSource = {
  FIREBASE_PROJECT_ID: "biblioteca-prueba",
  FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-abc@biblioteca-prueba.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nCLAVE-FALSA-XYZ789\n-----END PRIVATE KEY-----\n",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaFalsaApiKey123456",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "biblioteca-prueba.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "biblioteca-prueba",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1234567890:1234567890:web:abcdef123456",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_TOKEN-FALSO-555",
};

const REQUIRED = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

function checker(changes: EnvSource = {}): EnvChecker {
  return new EnvChecker({ ...VALID, ...changes });
}

function problemNames(env: EnvChecker): string[] {
  return env.problems().map((problem) => problem.name);
}

describe("Entorno · variables completas y coherentes", () => {
  it("es válido y no tiene problemas", () => {
    const env = checker();
    expect(env.isValid()).toBe(true);
    expect(env.problems()).toEqual([]);
  });

  it("BLOB_READ_WRITE_TOKEN ausente sigue siendo válido", () => {
    expect(checker({ BLOB_READ_WRITE_TOKEN: undefined }).isValid()).toBe(true);
  });

  it("BLOB_READ_WRITE_TOKEN vacío sigue siendo válido", () => {
    expect(checker({ BLOB_READ_WRITE_TOKEN: "" }).isValid()).toBe(true);
  });
});

describe("Entorno · variables que faltan", () => {
  it.each(REQUIRED)("si falta %s se nombra como problema", (name) => {
    const env = checker({ [name]: undefined });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain(name);
  });

  it.each(REQUIRED)("si %s está vacía se nombra como problema", (name) => {
    const env = checker({ [name]: "   " });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain(name);
  });

  it("sin ninguna variable, todas las obligatorias aparecen y la de Blob no", () => {
    const env = new EnvChecker({});
    const names = problemNames(env);
    for (const name of REQUIRED) {
      expect(names).toContain(name);
    }
    expect(names).not.toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("no repite la misma variable en los problemas", () => {
    const names = problemNames(new EnvChecker({}));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Entorno · coherencia entre variables", () => {
  it("el correo de la cuenta de servicio de otro proyecto es un problema", () => {
    const env = checker({ FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-abc@otro-proyecto.iam.gserviceaccount.com" });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain("FIREBASE_CLIENT_EMAIL");
  });

  it("NEXT_PUBLIC_FIREBASE_PROJECT_ID distinto de FIREBASE_PROJECT_ID es un problema", () => {
    const env = checker({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "otro-proyecto" });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  });

  it("una clave privada que no es PEM es un problema", () => {
    const env = checker({ FIREBASE_PRIVATE_KEY: "esto-no-es-una-clave" });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain("FIREBASE_PRIVATE_KEY");
  });

  it("una clave PEM con los saltos de línea escritos como \\n es válida", () => {
    const escaped = "-----BEGIN PRIVATE KEY-----\\nCLAVE-FALSA\\n-----END PRIVATE KEY-----\\n";
    expect(checker({ FIREBASE_PRIVATE_KEY: escaped }).isValid()).toBe(true);
  });

  it("una api key que no empieza por AIza es un problema", () => {
    const env = checker({ NEXT_PUBLIC_FIREBASE_API_KEY: "XXXXFalsaApiKey123456" });
    expect(env.isValid()).toBe(false);
    expect(problemNames(env)).toContain("NEXT_PUBLIC_FIREBASE_API_KEY");
  });
});

describe("Entorno · el informe no revela valores", () => {
  function assertNoValues(report: string, env: EnvSource) {
    for (const value of Object.values(env)) {
      if (value) {
        expect(report).not.toContain(value);
      }
    }
  }

  it("el informe de un entorno válido nombra las variables pero no imprime valores", () => {
    const report = checker().report();
    expect(report).toContain("FIREBASE_PROJECT_ID");
    assertNoValues(report, VALID);
    expect(report).not.toContain("CLAVE-FALSA");
    expect(report).not.toContain("TOKEN-FALSO");
  });

  it("el informe con problemas de formato tampoco imprime los valores incorrectos", () => {
    const broken: EnvSource = {
      ...VALID,
      FIREBASE_CLIENT_EMAIL: "cuenta-secreta@otro-proyecto.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "clave-que-no-es-pem-SECRETA",
      NEXT_PUBLIC_FIREBASE_API_KEY: "XXXX-api-key-mala",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "proyecto-distinto",
    };
    const report = new EnvChecker(broken).report();
    expect(report).toContain("FIREBASE_CLIENT_EMAIL");
    expect(report).toContain("FIREBASE_PRIVATE_KEY");
    assertNoValues(report, broken);
  });

  it("el informe de un entorno vacío nombra las variables que faltan", () => {
    const report = new EnvChecker({}).report();
    for (const name of REQUIRED) {
      expect(report).toContain(name);
    }
  });
});
