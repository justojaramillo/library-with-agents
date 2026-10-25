import { FirebaseError } from "firebase/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword, SessionRenewalError } from "../ui/auth-client";

type FakeUser = { email: string; getIdToken: (forceRefresh?: boolean) => Promise<string> };

const state = vi.hoisted(() => ({
  calls: [] as string[],
  signInCount: 0,
  signInErrors: [] as Array<Error | null>,
  updateErrors: [] as Array<Error | null>,
  signOutError: null as Error | null,
  tokenError: null as Error | null,
  fetchMode: "ok" as "ok" | "rejected" | "network",
  fetchBodies: [] as string[],
  fetchHeaders: [] as string[],
}));

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: async (_auth: object, email: string, password: string) => {
    state.calls.push(`signIn:${email}:${password}`);
    state.signInCount += 1;
    const token = `token-${state.signInCount}`;
    const failure = state.signInErrors.shift() ?? null;
    if (failure !== null) {
      throw failure;
    }
    const user: FakeUser = {
      email,
      getIdToken: async (forceRefresh?: boolean) => {
        state.calls.push(`getIdToken:${forceRefresh === true}`);
        if (state.tokenError !== null) {
          throw state.tokenError;
        }
        return token;
      },
    };
    return { user };
  },
  updatePassword: async (_user: FakeUser, next: string) => {
    state.calls.push(`updatePassword:${next}`);
    const failure = state.updateErrors.shift() ?? null;
    if (failure !== null) {
      throw failure;
    }
  },
  sendEmailVerification: async () => undefined,
  signOut: async () => {
    state.calls.push("signOut");
    if (state.signOutError !== null) {
      throw state.signOutError;
    }
  },
}));

vi.mock("@/shared/ui/firebase-client", () => ({
  getClientAuth: () => ({}),
}));

const EMAIL = "ana@example.com";
const CURRENT = "clave-actual-123";
const NEXT = "clave-nueva-456";

beforeEach(() => {
  state.calls = [];
  state.signInCount = 0;
  state.signInErrors = [];
  state.updateErrors = [];
  state.signOutError = null;
  state.tokenError = null;
  state.fetchMode = "ok";
  state.fetchBodies = [];
  state.fetchHeaders = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { method: string; body: string; headers: Record<string, string> }) => {
      state.calls.push(`fetch:${init.method}:${url}`);
      state.fetchBodies.push(init.body);
      state.fetchHeaders.push(init.headers["Content-Type"]);
      if (state.fetchMode === "network") {
        throw new TypeError("Failed to fetch");
      }
      if (state.fetchMode === "rejected") {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
      }
      return new Response(JSON.stringify({ member_id: "uid-1" }), { status: 200 });
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SIGN_IN_CURRENT = `signIn:${EMAIL}:${CURRENT}`;
const UPDATE = `updatePassword:${NEXT}`;
const SIGN_IN_NEXT = `signIn:${EMAIL}:${NEXT}`;
const LOGIN_REQUEST = "fetch:POST:/api/auth/login";
// Regla 5: reautenticar con la actual, cambiar, volver a ingresar con la nueva (token sin forzar), cookie, cerrar.
const HAPPY_FLOW = [SIGN_IN_CURRENT, UPDATE, SIGN_IN_NEXT, "getIdToken:false", LOGIN_REQUEST, "signOut"];

describe("F15 · changePassword · caso feliz (regla 5)", () => {
  it("reautentica, cambia la contraseña, vuelve a ingresar con la nueva, renueva la cookie y cierra la sesión del SDK, en ese orden", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    expect(state.calls).toEqual(HAPPY_FLOW);
  });

  it("reautentica con el correo y la contraseña actual, y cambia con la nueva", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    expect(state.calls[0]).toBe(`signIn:${EMAIL}:${CURRENT}`);
    expect(state.calls[1]).toBe(`updatePassword:${NEXT}`);
  });

  it("el segundo inicio de sesión usa el mismo correo y la contraseña nueva; la actual solo se usa antes del cambio", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    const signIns = state.calls.filter((call) => call.startsWith("signIn:"));
    expect(signIns).toEqual([SIGN_IN_CURRENT, SIGN_IN_NEXT]);
    expect(state.calls.indexOf(SIGN_IN_NEXT)).toBeGreaterThan(state.calls.indexOf(UPDATE));
    expect(state.calls.slice(state.calls.indexOf(UPDATE) + 1).some((call) => call.includes(CURRENT))).toBe(false);
  });

  it("el ID token sale del inicio de sesión con la nueva (sin forzar su renovación) y se manda como id_token al login", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    expect(state.calls).toContain("getIdToken:false");
    expect(state.calls).not.toContain("getIdToken:true");
    expect(JSON.parse(state.fetchBodies[0])).toEqual({ id_token: "token-2" });
    expect(state.fetchHeaders[0]).toBe("application/json");
  });

  it("resuelve sin valor", async () => {
    await expect(changePassword(EMAIL, CURRENT, NEXT)).resolves.toBeUndefined();
  });

  it("cambia la contraseña, pide la cookie y cierra una sola vez; ingresa dos veces (actual y nueva)", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    expect(state.calls.filter((call) => call.startsWith("signIn:"))).toHaveLength(2);
    expect(state.calls.filter((call) => call.startsWith("updatePassword:"))).toHaveLength(1);
    expect(state.calls.filter((call) => call === "signOut")).toHaveLength(1);
    expect(state.fetchBodies).toHaveLength(1);
  });
});

describe("F15 · changePassword · contraseña actual incorrecta (regla 4)", () => {
  it.each([
    "auth/invalid-credential",
    "auth/wrong-password",
    "auth/too-many-requests",
    "auth/network-request-failed",
  ])("con %s el error sube igual, la nueva contraseña no se envía a Firebase y no se pide cookie", async (code) => {
    state.signInErrors = [new FirebaseError(code, "detalle")];

    await expect(changePassword(EMAIL, "mala", NEXT)).rejects.toMatchObject({ code });

    expect(state.calls).toEqual([`signIn:${EMAIL}:mala`, "signOut"]);
    expect(state.calls.some((call) => call.startsWith("updatePassword:"))).toBe(false);
    expect(state.fetchBodies).toEqual([]);
  });

  it("el error de reautenticación es el mismo objeto de Firebase, no uno propio", async () => {
    const original = new FirebaseError("auth/invalid-credential", "mala");
    state.signInErrors = [original];

    await expect(changePassword(EMAIL, "mala", NEXT)).rejects.toBe(original);
  });

  it("no es un SessionRenewalError: la contraseña no cambió", async () => {
    state.signInErrors = [new FirebaseError("auth/invalid-credential", "mala")];

    await expect(changePassword(EMAIL, "mala", NEXT)).rejects.not.toBeInstanceOf(SessionRenewalError);
  });
});

describe("F15 · changePassword · fallos al cambiar la contraseña (regla 5)", () => {
  it("con auth/weak-password el error sube, no se pide cookie y se cierra la sesión del SDK", async () => {
    state.updateErrors = [new FirebaseError("auth/weak-password", "débil")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toMatchObject({ code: "auth/weak-password" });

    expect(state.calls).toEqual([SIGN_IN_CURRENT, UPDATE, "signOut"]);
    expect(state.fetchBodies).toEqual([]);
  });

  it("con auth/weak-password no se repite el cambio ni se reautentica otra vez", async () => {
    state.updateErrors = [new FirebaseError("auth/weak-password", "débil")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(FirebaseError);

    expect(state.calls.filter((call) => call.startsWith("signIn:"))).toHaveLength(1);
    expect(state.calls.filter((call) => call.startsWith("updatePassword:"))).toHaveLength(1);
  });

  it("con otro error de Firebase al cambiar, sube tal cual y no se repite", async () => {
    const original = new FirebaseError("auth/network-request-failed", "sin red");
    state.updateErrors = [original];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBe(original);

    expect(state.calls.filter((call) => call.startsWith("updatePassword:"))).toHaveLength(1);
  });

  it("un error que no es de Firebase al cambiar también sube tal cual", async () => {
    const original = new Error("fallo raro");
    state.updateErrors = [original];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBe(original);
    expect(state.calls.at(-1)).toBe("signOut");
  });
});

describe("F15 · changePassword · token vencido a mitad del flujo (regla 5)", () => {
  const recent = () => new FirebaseError("auth/requires-recent-login", "reciente");

  it("si Firebase pide ingreso reciente, reautentica y repite el cambio una vez, y todo sale bien", async () => {
    state.updateErrors = [recent()];

    await changePassword(EMAIL, CURRENT, NEXT);

    expect(state.calls).toEqual([
      SIGN_IN_CURRENT,
      UPDATE,
      SIGN_IN_CURRENT,
      UPDATE,
      SIGN_IN_NEXT,
      "getIdToken:false",
      LOGIN_REQUEST,
      "signOut",
    ]);
    expect(JSON.parse(state.fetchBodies[0])).toEqual({ id_token: "token-3" });
  });

  it("si vuelve a pedir ingreso reciente, el error sube y no hay un tercer intento", async () => {
    state.updateErrors = [recent(), recent()];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toMatchObject({ code: "auth/requires-recent-login" });

    expect(state.calls).toEqual([SIGN_IN_CURRENT, UPDATE, SIGN_IN_CURRENT, UPDATE, "signOut"]);
    expect(state.fetchBodies).toEqual([]);
  });

  it("si el segundo cambio falla por contraseña débil, sube ese error", async () => {
    state.updateErrors = [recent(), new FirebaseError("auth/weak-password", "débil")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toMatchObject({ code: "auth/weak-password" });

    expect(state.calls.filter((call) => call.startsWith("updatePassword:"))).toHaveLength(2);
  });

  it("si la segunda reautenticación falla, el error sube y el cambio no se repite", async () => {
    state.updateErrors = [recent()];
    state.signInErrors = [null, new FirebaseError("auth/too-many-requests", "bloqueo")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toMatchObject({ code: "auth/too-many-requests" });

    expect(state.calls).toEqual([SIGN_IN_CURRENT, UPDATE, SIGN_IN_CURRENT, "signOut"]);
  });

  it("repite con la misma contraseña actual y la misma nueva, y solo al final ingresa con la nueva", async () => {
    state.updateErrors = [recent()];

    await changePassword(EMAIL, CURRENT, NEXT);

    const signIns = state.calls.filter((call) => call.startsWith("signIn:"));
    const updates = state.calls.filter((call) => call.startsWith("updatePassword:"));
    expect(signIns).toEqual([SIGN_IN_CURRENT, SIGN_IN_CURRENT, SIGN_IN_NEXT]);
    expect(updates).toEqual([UPDATE, UPDATE]);
  });
});

describe("F15 · changePassword · la cookie nueva falla (regla 5)", () => {
  it("si el servidor responde con error, lanza SessionRenewalError y cierra la sesión del SDK igual", async () => {
    state.fetchMode = "rejected";

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.calls).toEqual(HAPPY_FLOW);
  });

  it("si no hay red al pedir la cookie, lanza SessionRenewalError y cierra la sesión del SDK igual", async () => {
    state.fetchMode = "network";

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.calls.at(-1)).toBe("signOut");
  });

  it("si el inicio de sesión con la nueva no entrega el token, lanza SessionRenewalError sin llamar al servidor", async () => {
    state.tokenError = new FirebaseError("auth/network-request-failed", "sin red");

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.fetchBodies).toEqual([]);
    expect(state.calls.at(-1)).toBe("signOut");
  });

  it.each([
    "auth/invalid-credential",
    "auth/wrong-password",
    "auth/too-many-requests",
    "auth/network-request-failed",
    "auth/internal-error",
  ])("si el segundo inicio de sesión (con la nueva) falla con %s, lanza SessionRenewalError sin llamar al servidor y cierra el SDK", async (code) => {
    state.signInErrors = [null, new FirebaseError(code, "detalle")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.calls).toEqual([SIGN_IN_CURRENT, UPDATE, SIGN_IN_NEXT, "signOut"]);
    expect(state.fetchBodies).toEqual([]);
  });

  it("si el segundo inicio de sesión falla con un error que no es de Firebase, también es SessionRenewalError", async () => {
    state.signInErrors = [null, new TypeError("Failed to fetch")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.fetchBodies).toEqual([]);
    expect(state.calls.at(-1)).toBe("signOut");
  });

  it("tras reintentar por ingreso reciente, si el inicio de sesión con la nueva falla, es SessionRenewalError", async () => {
    state.updateErrors = [new FirebaseError("auth/requires-recent-login", "reciente")];
    state.signInErrors = [null, null, new FirebaseError("auth/too-many-requests", "bloqueo")];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBeInstanceOf(SessionRenewalError);

    expect(state.calls).toEqual([SIGN_IN_CURRENT, UPDATE, SIGN_IN_CURRENT, UPDATE, SIGN_IN_NEXT, "signOut"]);
    expect(state.fetchBodies).toEqual([]);
  });

  it("el error de SessionRenewalError no es el de Firebase ni lleva la contraseña", async () => {
    state.signInErrors = [null, new FirebaseError("auth/invalid-credential", `detalle ${NEXT}`)];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toSatisfy(
      (error: Error) => error instanceof SessionRenewalError && !error.message.includes(NEXT),
    );
  });

  it("la contraseña se cambió una sola vez aunque la cookie falle", async () => {
    state.fetchMode = "rejected";

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toThrow();

    expect(state.calls.filter((call) => call.startsWith("updatePassword:"))).toHaveLength(1);
  });

  it("SessionRenewalError es un Error con nombre propio y no contiene las contraseñas", () => {
    const error = new SessionRenewalError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SessionRenewalError");
    expect(error.message).not.toContain(CURRENT);
    expect(error.message).not.toContain(NEXT);
  });
});

describe("F15 · changePassword · el cierre de la sesión del SDK ocurre siempre", () => {
  it("si el cierre falla, no cambia el resultado: el cambio sigue siendo un éxito", async () => {
    state.signOutError = new Error("sin sesión que cerrar");

    await expect(changePassword(EMAIL, CURRENT, NEXT)).resolves.toBeUndefined();
  });

  it("si el cierre falla tras un error, el error original es el que sube", async () => {
    state.signOutError = new Error("sin sesión que cerrar");
    const original = new FirebaseError("auth/weak-password", "débil");
    state.updateErrors = [original];

    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toBe(original);
  });
});

describe("F15 · changePassword · ninguna contraseña se registra (regla 7)", () => {
  it("no escribe nada con las contraseñas en la consola, ni en éxito ni en error", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    await changePassword(EMAIL, CURRENT, NEXT);
    state.updateErrors = [new FirebaseError("auth/weak-password", "débil")];
    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toThrow();
    state.fetchMode = "rejected";
    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toThrow();
    state.fetchMode = "ok";
    state.signInErrors = [null, new FirebaseError("auth/invalid-credential", "mala")];
    await expect(changePassword(EMAIL, CURRENT, NEXT)).rejects.toThrow();

    for (const spy of spies) {
      const printed = JSON.stringify(spy.mock.calls);
      expect(printed).not.toContain(CURRENT);
      expect(printed).not.toContain(NEXT);
    }
  });

  it("la petición al servidor no lleva ninguna de las dos contraseñas", async () => {
    await changePassword(EMAIL, CURRENT, NEXT);

    for (const body of state.fetchBodies) {
      expect(body).not.toContain(CURRENT);
      expect(body).not.toContain(NEXT);
    }
  });
});
