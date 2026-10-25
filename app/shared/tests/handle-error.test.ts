import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { ApiErrorSchema } from "@/shared/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@/shared/server/errors";
import { handleError } from "@/shared/server/http";
import { describeLoggedError } from "@/shared/server/security/error-log";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => ({}),
  getAdminDb: () => ({}),
}));

let logSpy: MockInstance<Console["error"]>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

/** Todo lo que se escribió en el log, con los objetos desplegados (pila y propiedades incluidas). */
function loggedText(): string {
  return logSpy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")).join("\n");
}

describe("S1 · handleError · límite de tasa (429)", () => {
  it("TooManyRequestsError responde 429 con la cabecera Retry-After en segundos", async () => {
    const response = handleError(new TooManyRequestsError("Demasiadas peticiones", 42));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Demasiadas peticiones");
  });

  it("un 429 no se registra como error interno", () => {
    handleError(new TooManyRequestsError("Demasiadas peticiones", 1));

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("S1 · handleError · traducción que no cambia", () => {
  it.each([
    ["UnauthorizedError", new UnauthorizedError("x"), 401],
    ["ForbiddenError", new ForbiddenError("x"), 403],
    ["NotFoundError", new NotFoundError("x"), 404],
    ["ConflictError", new ConflictError("x"), 409],
  ])("%s responde %i sin registrar nada", (_name, error, status) => {
    const response = handleError(error);

    expect(response.status).toBe(status);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("un error de validación de Zod responde 400", () => {
    const result = z.object({ n: z.number() }).safeParse({ n: "x" });
    if (result.success) {
      throw new Error("la validación debía fallar");
    }

    expect(handleError(result.error).status).toBe(400);
  });

  it("un JSON mal formado responde 400", async () => {
    const response = handleError(new SyntaxError("Unexpected token"));

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("JSON inválido");
  });

  it("un error de dominio que no sea 429 no lleva Retry-After", () => {
    expect(handleError(new ConflictError("x")).headers.get("Retry-After")).toBeNull();
  });
});

describe("S1 · handleError · registro de los 500 (regla 2)", () => {
  it("responde 500 «Error interno» sin filtrar el mensaje original", async () => {
    const response = handleError(new Error("clave privada: S3CR3T"));

    expect(response.status).toBe(500);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.error).toBe("Error interno");
    expect(JSON.stringify(body)).not.toContain("S3CR3T");
  });

  it("registra el nombre, el código de texto y el mensaje", () => {
    const error = Object.assign(new TypeError("no se pudo leer"), { code: "auth/internal-error" });

    handleError(error);

    const text = loggedText();
    expect(text).toContain("TypeError");
    expect(text).toContain("auth/internal-error");
    expect(text).toContain("no se pudo leer");
  });

  it("no registra la pila de llamadas", () => {
    handleError(new Error("falló"));

    expect(loggedText()).not.toMatch(/\n\s+at /);
    expect(loggedText()).not.toContain("handle-error.test");
  });

  it("no registra las demás propiedades del objeto de error", () => {
    const error = Object.assign(new Error("falló"), {
      code: "auth/internal-error",
      customData: { token: "TOKEN-SECRETO" },
      request: { headers: { authorization: "Bearer ABC123" } },
      password: "clave-segura-123",
    });

    handleError(error);

    const text = loggedText();
    expect(text).not.toContain("TOKEN-SECRETO");
    expect(text).not.toContain("ABC123");
    expect(text).not.toContain("clave-segura-123");
  });

  it("un code que no es texto no se registra", () => {
    const error = Object.assign(new Error("falló"), { code: 987654 });

    handleError(error);

    expect(loggedText()).not.toContain("987654");
  });

  it("recorta el mensaje a 200 caracteres: 200 se conservan y el 201 no", () => {
    handleError(new Error("x".repeat(500)));

    const text = loggedText();
    expect(text).toContain("x".repeat(200));
    expect(text).not.toContain("x".repeat(201));
  });

  it("un mensaje de exactamente 200 caracteres queda completo", () => {
    handleError(new Error("y".repeat(200)));

    expect(loggedText()).toContain("y".repeat(200));
  });

  it("un valor que no es un Error tampoco se vuelca al log", async () => {
    const response = handleError("texto con S3CR3T");

    expect(response.status).toBe(500);
    expect(loggedText()).not.toContain("S3CR3T");
  });

  it("registra una sola vez por error", () => {
    handleError(new Error("falló"));

    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("S1 regla 15 · handleError usa la misma descripción que el resto del código", () => {
  it("lo que registra para un 500 es exactamente describeLoggedError del error", () => {
    const error = Object.assign(new TypeError("m".repeat(300)), { code: "auth/internal-error", token: "TOKEN" });

    handleError(error);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]).toContain(describeLoggedError(error));
  });

  it("describeLoggedError lleva el nombre, el code de texto y el mensaje de hasta 200 caracteres", () => {
    const text = describeLoggedError(Object.assign(new RangeError("z".repeat(250)), { code: "app/rango" }));

    expect(text).toContain("RangeError");
    expect(text).toContain("app/rango");
    expect(text).toContain("z".repeat(200));
    expect(text).not.toContain("z".repeat(201));
    expect(text).not.toMatch(/\n\s+at /);
  });
});
