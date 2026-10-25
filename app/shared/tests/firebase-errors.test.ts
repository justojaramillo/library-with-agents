import { describe, expect, it } from "vitest";
import { describeAuthError, firebaseErrorCode, isExpectedAuthError } from "@/shared/server/security/firebase-errors";

const EXPECTED_CODES = [
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/argument-error",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
  "auth/invalid-id-token",
  "auth/invalid-session-cookie",
];

/** Error de Firebase simulado: un Error con propiedad `code`. */
class FakeFirebaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseAuthError";
  }
}

describe("Seguridad · código de un error de Firebase", () => {
  it("devuelve el código de un error de Firebase", () => {
    expect(firebaseErrorCode(new FakeFirebaseError("auth/user-not-found", "x"))).toBe("auth/user-not-found");
  });

  it("devuelve el código de un objeto simple con code", () => {
    expect(firebaseErrorCode({ code: "auth/argument-error" })).toBe("auth/argument-error");
  });

  it("devuelve undefined si no hay código", () => {
    expect(firebaseErrorCode(new Error("hola"))).toBeUndefined();
    expect(firebaseErrorCode({})).toBeUndefined();
  });

  it("devuelve undefined si el código no es texto", () => {
    expect(firebaseErrorCode({ code: 500 })).toBeUndefined();
  });

  it("devuelve undefined para null, undefined y valores primitivos", () => {
    expect(firebaseErrorCode(null)).toBeUndefined();
    expect(firebaseErrorCode(undefined)).toBeUndefined();
    expect(firebaseErrorCode("auth/user-not-found")).toBeUndefined();
  });
});

describe("Seguridad · errores de autenticación esperables", () => {
  it.each(EXPECTED_CODES)("%s es un rechazo normal de credenciales", (code) => {
    expect(isExpectedAuthError(new FakeFirebaseError(code, "m"))).toBe(true);
  });

  it("auth/internal-error es un fallo de infraestructura, no esperable", () => {
    expect(isExpectedAuthError(new FakeFirebaseError("auth/internal-error", "m"))).toBe(false);
  });

  it("un código desconocido no es esperable", () => {
    expect(isExpectedAuthError({ code: "auth/algo-nuevo" })).toBe(false);
  });

  it("un Error común sin código no es esperable", () => {
    expect(isExpectedAuthError(new Error("boom"))).toBe(false);
  });

  it("null, undefined y texto no son esperables", () => {
    expect(isExpectedAuthError(null)).toBe(false);
    expect(isExpectedAuthError(undefined)).toBe(false);
    expect(isExpectedAuthError("auth/user-disabled")).toBe(false);
  });
});

describe("Seguridad · descripción segura para el log", () => {
  const SECRETO = "sk-super-secreto-12345";

  it("devuelve solo el código y nunca el mensaje", () => {
    const error = new FakeFirebaseError("auth/internal-error", `fallo con ${SECRETO}`);
    const text = describeAuthError(error);
    expect(text).toBe("auth/internal-error");
    expect(text).not.toContain(SECRETO);
  });

  it("sin código devuelve el nombre del error y nunca el mensaje", () => {
    const error = new TypeError(`token ${SECRETO}`);
    const text = describeAuthError(error);
    expect(text).toBe("TypeError");
    expect(text).not.toContain(SECRETO);
  });

  it("un valor que no es Error ni trae código no se imprime", () => {
    const text = describeAuthError(SECRETO);
    expect(text).not.toContain(SECRETO);
    expect(text.length).toBeGreaterThan(0);
  });

  it("null y undefined producen una descripción no vacía", () => {
    expect(describeAuthError(null).length).toBeGreaterThan(0);
    expect(describeAuthError(undefined).length).toBeGreaterThan(0);
  });
});
