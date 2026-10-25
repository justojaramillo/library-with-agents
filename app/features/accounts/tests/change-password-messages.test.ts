import { FirebaseError } from "firebase/app";
import { describe, expect, it, vi } from "vitest";
import { SessionRenewalError } from "@/features/accounts/ui/auth-client";
import { messageForPasswordError } from "@/features/accounts/ui/change-password-form";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const WRONG_CURRENT = "La contraseña actual es incorrecta.";
const TOO_MANY = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
const WEAK = "La nueva contraseña es demasiado débil.";
const RECENT_LOGIN = "Vuelve a ingresar e inténtalo de nuevo.";
const RENEWAL = "Tu contraseña se cambió. Vuelve a ingresar con la nueva.";
const GENERIC = "No se pudo cambiar la contraseña. Inténtalo de nuevo.";

describe("F15 · Mensaje según el error al cambiar la contraseña (reglas 4 y 5)", () => {
  it.each([
    ["auth/invalid-credential", WRONG_CURRENT],
    ["auth/wrong-password", WRONG_CURRENT],
    ["auth/too-many-requests", TOO_MANY],
    ["auth/weak-password", WEAK],
    ["auth/requires-recent-login", RECENT_LOGIN],
  ])("%s muestra el mensaje de la especificación", (code, message) => {
    expect(messageForPasswordError(new FirebaseError(code, "detalle interno"))).toBe(message);
  });

  it("SessionRenewalError avisa que la contraseña ya cambió y que debe ingresar con la nueva", () => {
    expect(messageForPasswordError(new SessionRenewalError())).toBe(RENEWAL);
  });

  it.each([
    "auth/network-request-failed",
    "auth/internal-error",
    "auth/user-not-found",
    "auth/user-disabled",
    "auth/invalid-email",
    "auth/invalid-login-credentials",
    "auth/missing-password",
    "auth/operation-not-allowed",
  ])("otro código de Firebase (%s) usa el mensaje genérico", (code) => {
    expect(messageForPasswordError(new FirebaseError(code, "detalle"))).toBe(GENERIC);
  });

  it("un código parecido pero no idéntico usa el genérico", () => {
    expect(messageForPasswordError(new FirebaseError("auth/weak-password-x", "x"))).toBe(GENERIC);
    expect(messageForPasswordError(new FirebaseError("AUTH/WEAK-PASSWORD", "x"))).toBe(GENERIC);
    expect(messageForPasswordError(new FirebaseError("weak-password", "x"))).toBe(GENERIC);
  });
});

describe("F15 · Mensaje para valores que no son un error de Firebase", () => {
  it("un Error normal usa el genérico", () => {
    expect(messageForPasswordError(new Error("boom"))).toBe(GENERIC);
  });

  it("un Error normal cuyo texto parece un código de Firebase usa el genérico", () => {
    expect(messageForPasswordError(new Error("auth/invalid-credential"))).toBe(GENERIC);
    expect(messageForPasswordError(new Error("auth/weak-password"))).toBe(GENERIC);
  });

  it("un texto con el código usa el genérico", () => {
    expect(messageForPasswordError("auth/too-many-requests")).toBe(GENERIC);
  });

  it("un objeto con la forma de un error de Firebase pero que no lo es usa el genérico", () => {
    expect(messageForPasswordError({ code: "auth/invalid-credential", message: "x" })).toBe(GENERIC);
  });

  it("null, undefined, un número y un objeto vacío usan el genérico", () => {
    expect(messageForPasswordError(null)).toBe(GENERIC);
    expect(messageForPasswordError(undefined)).toBe(GENERIC);
    expect(messageForPasswordError(42)).toBe(GENERIC);
    expect(messageForPasswordError({})).toBe(GENERIC);
  });
});

describe("F15 · Los mensajes no revelan datos internos", () => {
  const codes = [
    "auth/invalid-credential",
    "auth/wrong-password",
    "auth/too-many-requests",
    "auth/weak-password",
    "auth/requires-recent-login",
    "auth/network-request-failed",
  ];

  it.each(codes)("el mensaje de %s no contiene el código ni el detalle de Firebase", (code) => {
    const message = messageForPasswordError(new FirebaseError(code, "detalle con ana@example.com y clave-secreta"));

    expect(message).not.toContain("auth/");
    expect(message).not.toContain("ana@example.com");
    expect(message).not.toContain("clave-secreta");
  });
});
