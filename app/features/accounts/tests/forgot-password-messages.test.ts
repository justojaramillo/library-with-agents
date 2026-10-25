import { FirebaseError } from "firebase/app";
import { describe, expect, it, vi } from "vitest";
import { messageForResetError } from "@/features/accounts/ui/forgot-password-form";

// El navegador aporta el enrutador; en pruebas (entorno node) se sustituye por uno inerte.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const GENERIC = "No se pudo enviar el enlace. Inténtalo de nuevo.";

describe("F16 · Mensaje según el error de Firebase al pedir el enlace (regla 11)", () => {
  it("auth/user-not-found cuenta como éxito: no hay mensaje de error (null)", () => {
    expect(messageForResetError(new FirebaseError("auth/user-not-found", "no existe"))).toBeNull();
  });

  it("auth/invalid-email pide un correo válido", () => {
    expect(messageForResetError(new FirebaseError("auth/invalid-email", "mal formado"))).toBe(
      "Escribe un correo válido.",
    );
  });

  it("auth/too-many-requests pide esperar unos minutos", () => {
    expect(messageForResetError(new FirebaseError("auth/too-many-requests", "bloqueo"))).toBe(
      "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
    );
  });

  it("otro error de Firebase (red, configuración) usa el mensaje genérico", () => {
    expect(messageForResetError(new FirebaseError("auth/network-request-failed", "sin red"))).toBe(GENERIC);
    expect(messageForResetError(new FirebaseError("auth/internal-error", "interno"))).toBe(GENERIC);
  });

  it("un error normal usa el mensaje genérico", () => {
    expect(messageForResetError(new Error("boom"))).toBe(GENERIC);
  });

  it("un texto, null o un número usan el mensaje genérico (nunca null: null significa éxito)", () => {
    expect(messageForResetError("auth/user-not-found")).toBe(GENERIC);
    expect(messageForResetError(null)).toBe(GENERIC);
    expect(messageForResetError(42)).toBe(GENERIC);
  });

  it("solo el código exacto de Firebase cambia el mensaje: otro código parecido es genérico", () => {
    expect(messageForResetError(new FirebaseError("auth/user-disabled", "deshabilitada"))).toBe(GENERIC);
  });
});
