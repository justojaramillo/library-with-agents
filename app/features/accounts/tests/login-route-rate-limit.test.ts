import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { aMember, makeWorld, type World } from "@/tests/helpers/factories";
import { MemberSchema } from "../schema";
import { POST as loginRoute } from "@/api/auth/login/route";
import { POST as registerRoute } from "@/api/auth/register/route";

const holder = vi.hoisted(() => ({ world: null as World | null }));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/shared/server/firebase", () => ({
  getAdminAuth: () => {
    throw new Error("la ruta pública no debe usar Firebase Admin");
  },
  getAdminDb: () => {
    throw new Error("la ruta pública no debe usar Firestore");
  },
}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { auth: holder.world.auth, members: holder.world.members };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");
const IP = "203.0.113.7";

function currentWorld(): World {
  if (holder.world === null) {
    throw new Error("sin mundo");
  }
  return holder.world;
}

function loginRequest(rawBody: string, headers: Record<string, string> = {}, ip?: string): NextRequest {
  const all: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...headers };
  if (ip !== undefined) {
    all["x-forwarded-for"] = ip;
  }
  return new NextRequest("http://localhost/api/auth/login", { method: "POST", headers: all, body: rawBody });
}

function loginWith(idToken: string, ip?: string) {
  return loginRoute(loginRequest(JSON.stringify({ id_token: idToken }), {}, ip));
}

/** Un `id_token` válido por llamada, como el que entrega el SDK de cliente tras ingresar. */
async function validToken(email: string): Promise<string> {
  await currentWorld().members.register(aMember({ email, password: "clave-segura-123" }));
  const token = await currentWorld().identity.signIn(email, "clave-segura-123");
  if (token === null) {
    throw new Error("la identidad no devolvió un token");
  }
  return token;
}

beforeEach(() => {
  resetRateLimits();
  holder.world = makeWorld();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F17 · POST /api/auth/login sigue funcionando como en F4", () => {
  it("con un id_token válido responde 200, la cuenta y la cookie de sesión", async () => {
    const token = await validToken("ana@example.com");

    const response = await loginWith(token, IP);

    expect(response.status).toBe(200);
    expect(MemberSchema.parse(await response.json()).email).toBe("ana@example.com");
    expect(response.headers.get("set-cookie")).toContain("session=");
  });

  it("con un id_token inválido responde 401 con «Credenciales inválidas»", async () => {
    const response = await loginWith("token-falso", IP);

    expect(response.status).toBe(401);
    expect(ApiErrorSchema.parse(await response.json()).error).toBe("Credenciales inválidas");
  });
});

describe("F17 regla 14 · límite de 30 por minuto por IP", () => {
  it("con tokens válidos: las 30 primeras llamadas pasan y la 31.ª recibe 429 con Retry-After", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 30; i += 1) {
      expect((await loginWith(token, IP)).status).toBe(200);
    }

    const response = await loginWith(token, IP);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("con tokens inválidos: las 30 primeras dan 401 (no 429) y la 31.ª da 429", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await loginWith(`falso-${i}`, IP)).status).toBe(401);
    }

    expect((await loginWith("falso-31", IP)).status).toBe(429);
  });

  it("agotado el cupo, un token válido tampoco entra: 429", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 30; i += 1) {
      await loginWith(`falso-${i}`, IP);
    }

    expect((await loginWith(token, IP)).status).toBe(429);
  });

  it("mezclando válidos e inválidos se cuentan todos juntos", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 15; i += 1) {
      expect((await loginWith(token, IP)).status).toBe(200);
      expect((await loginWith("falso", IP)).status).toBe(401);
    }

    expect((await loginWith(token, IP)).status).toBe(429);
  });

  it("otra IP no se ve afectada", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 31; i += 1) {
      await loginWith(token, IP);
    }
    expect((await loginWith(token, IP)).status).toBe(429);

    expect((await loginWith(token, "198.51.100.9")).status).toBe(200);
  });

  it("pasado el minuto (60 s) vuelve a responder; a los 59,999 s todavía no", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 31; i += 1) {
      await loginWith(token, IP);
    }

    vi.setSystemTime(new Date(T0.getTime() + 59_999));
    expect((await loginWith(token, IP)).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    expect((await loginWith(token, IP)).status).toBe(200);
  });

  it("sin IP válida no se limita: 40 llamadas no dan 429", async () => {
    for (let i = 0; i < 40; i += 1) {
      expect((await loginWith("falso")).status).toBe(401);
    }
  });

  it("con una IP inválida en la cabecera tampoco se limita", async () => {
    for (let i = 0; i < 40; i += 1) {
      expect((await loginWith("falso", "no-soy-una-ip")).status).toBe(401);
    }
  });
});

describe("F17 regla 14 · el orden: origen, límite, cuerpo", () => {
  async function exhaust() {
    for (let i = 0; i < 30; i += 1) {
      await loginWith("falso", IP);
    }
  }

  it("agotado el cupo, ni siquiera se lee el cuerpo de la petición", async () => {
    await exhaust();
    const req = loginRequest(JSON.stringify({ id_token: "falso" }), {}, IP);
    const readBody = vi.spyOn(req, "json");

    const response = await loginRoute(req);

    expect(response.status).toBe(429);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("agotado el cupo, un cuerpo que no es JSON responde 429 y no 400", async () => {
    await exhaust();

    expect((await loginRoute(loginRequest("esto no es json", {}, IP))).status).toBe(429);
  });

  it("dentro del cupo, un cuerpo que no es JSON responde 400", async () => {
    expect((await loginRoute(loginRequest("esto no es json", {}, IP))).status).toBe(400);
  });

  it("el origen se comprueba antes que el límite: de otro origen siempre 403, y no gasta el cupo", async () => {
    await exhaust();
    const crossOrigin = loginRequest(JSON.stringify({ id_token: "falso" }), { origin: "https://evil.example" }, IP);

    expect((await loginRoute(crossOrigin)).status).toBe(403);
  });

  it("las peticiones de otro origen no gastan el cupo de la IP", async () => {
    for (let i = 0; i < 40; i += 1) {
      const blocked = loginRequest(JSON.stringify({ id_token: "falso" }), { "sec-fetch-site": "cross-site" }, IP);
      expect((await loginRoute(blocked)).status).toBe(403);
    }

    expect((await loginWith("falso", IP)).status).toBe(401);
  });
});

describe("F10 / F17 · los cubos de registro e ingreso son independientes", () => {
  it("agotar el ingreso de una IP no impide que se registre", async () => {
    for (let i = 0; i < 31; i += 1) {
      await loginWith("falso", IP);
    }
    expect((await loginWith("falso", IP)).status).toBe(429);

    const response = await registerRoute(
      new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": IP },
        body: JSON.stringify({ name: "Ana", email: "ana@example.com", password: "clave-segura-123" }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("agotar el registro de una IP no impide que ingrese", async () => {
    const token = await validToken("ana@example.com");
    for (let i = 0; i < 11; i += 1) {
      await registerRoute(
        new NextRequest("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": IP },
          body: JSON.stringify({ name: "X", email: `x${i}@example.com`, password: "clave-segura-123" }),
        }),
      );
    }

    expect((await loginWith(token, IP)).status).toBe(200);
  });
});
