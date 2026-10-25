import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S1 regla 18: el cliente de Firebase usa `initializeAuth` con persistencia en memoria y sin resolutor de ventanas
 * emergentes (así no carga `apis.google.com` ni el iframe `__/auth` que la CSP bloquea). El SDK se sustituye por
 * dobles: no se prueba Firebase, solo cómo lo configura la app.
 */
type FakeApp = { name: string };
type FakeAuth = { kind: string };

const sdk = vi.hoisted(() => {
  const memory = { type: "NONE" };
  return {
    memory,
    app: { name: "app-de-prueba" },
    apps: [] as { name: string }[],
    initializeApp: vi.fn(),
    getApps: vi.fn(),
    getApp: vi.fn(),
    initializeAuth: vi.fn<(app: { name: string }, options: Record<string, object>) => object>(),
    getAuth: vi.fn(),
  };
});

vi.mock("firebase/app", () => ({
  initializeApp: sdk.initializeApp,
  getApps: sdk.getApps,
  getApp: sdk.getApp,
}));
vi.mock("firebase/auth", () => ({
  inMemoryPersistence: sdk.memory,
  initializeAuth: sdk.initializeAuth,
  getAuth: sdk.getAuth,
}));

import { getClientAuth } from "@/shared/ui/firebase-client";

const created: FakeAuth = { kind: "recién creada" };
const existing: FakeAuth = { kind: "ya existente" };

beforeEach(() => {
  vi.resetAllMocks();
  const app: FakeApp = sdk.app;
  sdk.getApps.mockReturnValue([]);
  sdk.initializeApp.mockReturnValue(app);
  sdk.getApp.mockReturnValue(app);
  sdk.initializeAuth.mockReturnValue(created);
  sdk.getAuth.mockReturnValue(existing);
});

describe("S1 regla 18 · getClientAuth", () => {
  it("usa initializeAuth con persistencia en memoria", () => {
    const auth = getClientAuth();

    expect(auth).toBe(created);
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAuth.mock.calls[0]?.[1]).toMatchObject({ persistence: sdk.memory });
  });

  it("no pasa un resolutor de ventanas emergentes", () => {
    getClientAuth();

    const options = sdk.initializeAuth.mock.calls[0]?.[1] ?? {};
    expect(options).not.toHaveProperty("popupRedirectResolver");
    expect(Object.keys(options)).toEqual(["persistence"]);
  });

  it("inicializa la app web una sola vez y la reutiliza si ya existe", () => {
    getClientAuth();
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);

    sdk.getApps.mockReturnValue([sdk.app]);
    getClientAuth();

    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.getApp).toHaveBeenCalled();
  });

  it("si initializeAuth ya se llamó para la app (recarga en caliente), reutiliza la instancia con getAuth", () => {
    sdk.initializeAuth.mockImplementation(() => {
      throw Object.assign(new Error("Firebase: Error (auth/already-initialized)."), {
        code: "auth/already-initialized",
      });
    });

    const auth = getClientAuth();

    expect(auth).toBe(existing);
    expect(sdk.getAuth).toHaveBeenCalledWith(sdk.app);
  });

  it("un Error sin code se relanza y no se llama a getAuth", () => {
    const failure = new Error("auth/already-initialized");
    sdk.initializeAuth.mockImplementation(() => {
      throw failure;
    });

    expect(() => getClientAuth()).toThrow(failure);
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it("un Error con otro code se relanza y no se llama a getAuth", () => {
    const failure = Object.assign(new Error("clave de API no válida"), { code: "auth/invalid-api-key" });
    sdk.initializeAuth.mockImplementation(() => {
      throw failure;
    });

    expect(() => getClientAuth()).toThrow(failure);
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it("un code que no es texto (aunque se parezca) se relanza y no se llama a getAuth", () => {
    const failure = Object.assign(new Error("raro"), { code: 42 });
    sdk.initializeAuth.mockImplementation(() => {
      throw failure;
    });

    expect(() => getClientAuth()).toThrow(failure);
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it("un valor lanzado que no es un objeto (texto) no rompe la comprobación: se relanza tal cual", () => {
    sdk.initializeAuth.mockImplementation(() => {
      throw "auth/already-initialized";
    });

    expect(() => getClientAuth()).toThrow("auth/already-initialized");
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it("un null lanzado no rompe la comprobación: se relanza y no se llama a getAuth", () => {
    sdk.initializeAuth.mockImplementation(() => {
      throw null;
    });

    let thrown = "no se lanzó nada";
    try {
      getClientAuth();
    } catch (error) {
      thrown = String(error);
    }

    expect(thrown).toBe("null");
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it("en el camino normal no llama a getAuth (que cargaría el resolutor por defecto)", () => {
    getClientAuth();

    expect(sdk.getAuth).not.toHaveBeenCalled();
  });
});
