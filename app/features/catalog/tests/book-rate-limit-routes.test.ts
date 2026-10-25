import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@/shared/schema";
import { resetRateLimits } from "@/shared/server/security/rate-limit";
import { aBook, makeWorld, type World } from "@/tests/helpers/factories";
import { GET as booksRoute } from "@/api/books/route";

const holder = vi.hoisted(() => ({ world: null as World | null }));

vi.mock("server-only", () => ({}));

vi.mock("@/features/container", () => ({
  getContainer: () => {
    if (holder.world === null) {
      throw new Error("la prueba no preparó el mundo");
    }
    return { books: holder.world.books };
  },
}));

const T0 = new Date("2026-01-10T10:00:00.000Z");

function get(search: string, forwardedFor?: string) {
  const headers = new Headers();
  if (forwardedFor !== undefined) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  return booksRoute(new NextRequest(`http://localhost/api/books${search}`, { headers }));
}

async function hit(count: number, forwardedFor?: string) {
  for (let i = 0; i < count; i += 1) {
    expect((await get("?q=prueba", forwardedFor)).status).toBe(200);
  }
}

beforeEach(async () => {
  resetRateLimits();
  holder.world = makeWorld();
  await holder.world.books.create(aBook({ title: "Libro de prueba" }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/books · límite de tasa por IP (S1 regla 4)", () => {
  it("las primeras 60 peticiones de una IP pasan y la 61 recibe 429 con Retry-After", async () => {
    await hit(60, "203.0.113.7");

    const response = await get("?q=prueba", "203.0.113.7");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("pasado el minuto vuelve a responder 200", async () => {
    await hit(60, "203.0.113.7");
    expect((await get("?q=prueba", "203.0.113.7")).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + 60_000));

    expect((await get("?q=prueba", "203.0.113.7")).status).toBe(200);
  });

  it("otra IP no se ve afectada", async () => {
    await hit(60, "203.0.113.7");
    expect((await get("?q=prueba", "203.0.113.7")).status).toBe(429);

    expect((await get("?q=prueba", "198.51.100.9")).status).toBe(200);
  });

  it("solo cuenta la primera IP de x-forwarded-for", async () => {
    await hit(60, "203.0.113.7, 10.0.0.1");

    expect((await get("?q=prueba", "203.0.113.7, 10.0.0.99")).status).toBe(429);
  });

  it("sin IP la clave es «desconocida» y no se limita (S1 regla 12): 100 peticiones seguidas responden 200", async () => {
    await hit(100);
  });

  it("un valor que no es una IP no se limita: 100 peticiones seguidas responden 200", async () => {
    await hit(100, "no-soy-una-ip");
  });

  it("una cabecera de 8000 caracteres no se limita: 100 peticiones seguidas responden 200", async () => {
    await hit(100, "a".repeat(8000));
  });

  it("x-vercel-forwarded-for manda sobre x-forwarded-for: se cuenta por la IP de Vercel", async () => {
    const withBoth = (vercel: string, forwarded: string) =>
      booksRoute(
        new NextRequest("http://localhost/api/books?q=prueba", {
          headers: { "x-vercel-forwarded-for": vercel, "x-forwarded-for": forwarded },
        }),
      );
    for (let i = 0; i < 60; i += 1) {
      expect((await withBoth("203.0.113.7", `198.51.100.${i + 1}`)).status).toBe(200);
    }

    expect((await withBoth("203.0.113.7", "192.0.2.1")).status).toBe(429);
  });

  it("el límite aplica antes que la validación: agotado el cupo, un limit inválido responde 429 y no 400", async () => {
    await hit(60, "203.0.113.7");

    expect((await get("?q=prueba&limit=999", "203.0.113.7")).status).toBe(429);
  });

  it("antes de agotar el cupo, un limit inválido sigue respondiendo 400", async () => {
    expect((await get("?q=prueba&limit=999", "203.0.113.7")).status).toBe(400);
  });
});
