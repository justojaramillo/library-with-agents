import { FirebaseError } from "firebase/app";
import { describe, expect, it, vi } from "vitest";
import { failureForError } from "@/features/accounts/ui/login-form";

// El formulario importa el enrutador del navegador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const TOO_MANY = "Demasiados intentos. Espera unos minutos o recupera tu contraseña.";
const CREDENTIALS = "Credenciales inválidas";
const DEFAULT = "No se pudo ingresar";

describe("F17 · Ingreso · demasiados intentos (reglas 15–16)", () => {
  it("auth/too-many-requests avisa de los intentos y ofrece recuperar la contraseña", () => {
    const failure = failureForError(new FirebaseError("auth/too-many-requests", "bloqueado"));
    expect(failure).toEqual({ message: TOO_MANY, offerRecovery: true });
  });
});

describe("F4 · Ingreso · credenciales inválidas con un único mensaje (regla 4)", () => {
  const credentialCodes = [
    "auth/invalid-credential",
    "auth/invalid-login-credentials",
    "auth/wrong-password",
    "auth/user-not-found",
    "auth/invalid-email",
    "auth/user-disabled",
    "auth/missing-password",
  ];

  for (const code of credentialCodes) {
    it(`${code} muestra «Credenciales inválidas» sin ofrecer recuperación`, () => {
      const failure = failureForError(new FirebaseError(code, "detalle interno"));
      expect(failure).toEqual({ message: CREDENTIALS, offerRecovery: false });
    });
  }

  it("el mensaje no revela el código ni el detalle de Firebase", () => {
    const failure = failureForError(new FirebaseError("auth/user-not-found", "no existe el usuario x@y.co"));
    expect(failure.message).not.toContain("auth/");
    expect(failure.message).not.toContain("x@y.co");
  });
});

describe("Ingreso · cualquier otro fallo muestra «No se pudo ingresar»", () => {
  it("un FirebaseError con otro código", () => {
    expect(failureForError(new FirebaseError("auth/network-request-failed", "red"))).toEqual({
      message: DEFAULT,
      offerRecovery: false,
    });
  });

  it("un código parecido pero no idéntico no cuenta como credencial inválida ni como exceso de intentos", () => {
    expect(failureForError(new FirebaseError("auth/too-many-requests-x", "x")).offerRecovery).toBe(false);
    expect(failureForError(new FirebaseError("auth/too-many-requests-x", "x")).message).toBe(DEFAULT);
    expect(failureForError(new FirebaseError("auth/invalid-credential-x", "x")).message).toBe(DEFAULT);
  });

  it("un Error normal", () => {
    expect(failureForError(new Error("boom"))).toEqual({ message: DEFAULT, offerRecovery: false });
  });

  it("un texto", () => {
    expect(failureForError("auth/too-many-requests")).toEqual({ message: DEFAULT, offerRecovery: false });
  });

  it("null", () => {
    expect(failureForError(null)).toEqual({ message: DEFAULT, offerRecovery: false });
  });

  it("un número", () => {
    expect(failureForError(42)).toEqual({ message: DEFAULT, offerRecovery: false });
  });

  it("un objeto con la forma de un error de Firebase, pero que no lo es", () => {
    expect(failureForError({ code: "auth/too-many-requests", message: "x" })).toEqual({
      message: DEFAULT,
      offerRecovery: false,
    });
  });
});
