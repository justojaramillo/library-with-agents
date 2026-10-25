import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendVerificationEmail, sendVerificationToSignedInUser } from "../ui/auth-client";

type FakeUser = { email: string };

const state = vi.hoisted(() => ({
  calls: [] as string[],
  currentUser: null as { email: string } | null,
  signInError: null as Error | null,
  sendError: null as Error | null,
}));

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: async (_auth: object, email: string) => {
    state.calls.push(`signIn:${email}`);
    if (state.signInError !== null) {
      throw state.signInError;
    }
    state.currentUser = { email };
    return { user: { email } };
  },
  sendEmailVerification: async (user: FakeUser) => {
    state.calls.push(`send:${user.email}`);
    if (state.sendError !== null) {
      throw state.sendError;
    }
  },
  signOut: async () => {
    state.calls.push("signOut");
    state.currentUser = null;
  },
}));

vi.mock("@/shared/ui/firebase-client", () => ({
  getClientAuth: () => ({
    get currentUser() {
      return state.currentUser;
    },
  }),
}));

beforeEach(() => {
  state.calls = [];
  state.currentUser = null;
  state.signInError = null;
  state.sendError = null;
});

describe("F11 · reenvío del correo de verificación (regla 4)", () => {
  it("inicia sesión con el SDK, envía el correo y cierra la sesión del SDK, en ese orden", async () => {
    await sendVerificationEmail("ana@example.com", "clave-segura-123");

    expect(state.calls).toEqual(["signIn:ana@example.com", "send:ana@example.com", "signOut"]);
    expect(state.currentUser).toBeNull();
  });

  it("con la contraseña incorrecta el error sube a quien llama, no se envía nada y no queda sesión", async () => {
    state.signInError = new Error("auth/wrong-password");

    await expect(sendVerificationEmail("ana@example.com", "mala")).rejects.toThrow("auth/wrong-password");

    expect(state.calls).toEqual(["signIn:ana@example.com", "signOut"]);
  });

  it("si el envío falla (demasiados intentos), el error sube y la sesión del SDK se cierra igual", async () => {
    state.sendError = new Error("auth/too-many-requests");

    await expect(sendVerificationEmail("ana@example.com", "clave-segura-123")).rejects.toThrow(
      "auth/too-many-requests",
    );

    expect(state.calls).toEqual(["signIn:ana@example.com", "send:ana@example.com", "signOut"]);
    expect(state.currentUser).toBeNull();
  });
});

describe("F11 · envío tras el registro (regla 3)", () => {
  it("con la sesión del SDK abierta, envía el correo de verificación a esa cuenta", async () => {
    state.currentUser = { email: "nueva@example.com" };

    await sendVerificationToSignedInUser();

    expect(state.calls).toEqual(["send:nueva@example.com"]);
  });

  it("sin sesión del SDK no envía nada y no falla", async () => {
    await expect(sendVerificationToSignedInUser()).resolves.toBeUndefined();

    expect(state.calls).toEqual([]);
  });

  it("si el envío falla, el error sube para que el registro lo ignore", async () => {
    state.currentUser = { email: "nueva@example.com" };
    state.sendError = new Error("auth/network-request-failed");

    await expect(sendVerificationToSignedInUser()).rejects.toThrow("auth/network-request-failed");
  });
});
