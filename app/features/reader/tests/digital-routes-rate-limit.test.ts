import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, resetRateLimits } from "@/shared/server/security/rate-limit";
import { routeHolder, resetRouteHolder, signInAs } from "@/tests/helpers/digital-route-state";
import { errorOf, getInfo, patchCopies, putContent, putContentRaw } from "@/tests/helpers/digital-route-calls";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => (await import("@/tests/helpers/digital-route-state")).headersMock);
vi.mock("@/shared/server/firebase", async () => (await import("@/tests/helpers/digital-route-state")).firebaseMock);
vi.mock("@/features/container", async () => (await import("@/tests/helpers/digital-route-state")).containerMock);

const T0 = new Date("2026-03-05T12:00:00.000Z");
const HOUR_MS = 3_600_000;

beforeEach(() => {
  resetRateLimits();
  resetRouteHolder();
  signInAs("BIBLIOTECARIO", "staff-1");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function upload(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    expect((await putContent("libro-1", `# Versión ${i}`)).status).toBe(200);
  }
}

describe("F27 · Subidas · límite de 20 por hora por cuenta de personal", () => {
  it("el límite configurado es de 20 por hora", () => {
    expect(RATE_LIMITS.contentUpload).toEqual({ limit: 20, windowMs: HOUR_MS });
  });

  it("las primeras 20 subidas pasan y la 21 recibe 429 con Retry-After y no guarda nada", async () => {
    await upload(20);
    const before = routeHolder.world.store.paths();

    const response = await putContent("libro-1", "# Subida 21");

    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect((await errorOf(response)).length).toBeGreaterThan(0);
    expect(routeHolder.world.store.paths()).toEqual(before);
  });

  it("otra cuenta de personal no se ve afectada", async () => {
    await upload(20);
    expect((await putContent("libro-1", "# Subida 21")).status).toBe(429);

    signInAs("ADMINISTRADOR", "staff-2");

    expect((await putContent("libro-1", "# Otra cuenta")).status).toBe(200);
  });

  it("pasada la hora vuelve a funcionar", async () => {
    await upload(20);
    expect((await putContent("libro-1", "# Subida 21")).status).toBe(429);

    vi.setSystemTime(new Date(T0.getTime() + HOUR_MS));

    expect((await putContent("libro-1", "# Después de la hora")).status).toBe(200);
  });

  it("antes de cumplirse la hora sigue bloqueada", async () => {
    await upload(20);

    vi.setSystemTime(new Date(T0.getTime() + HOUR_MS - 1000));

    expect((await putContent("libro-1", "# Aún no")).status).toBe(429);
  });

  it("el límite se aplica antes de validar el :id y el cuerpo, y antes de leerlo", async () => {
    await upload(20);

    expect((await putContent("a/b", "# Texto")).status).toBe(429);
    expect((await putContentRaw("libro-1", "no es json")).status).toBe(429);
    expect((await putContent("libro-1", "a".repeat(4_300_000))).status).toBe(429);
  });

  it("una cuenta bloqueada puede seguir consultando y fijando copias", async () => {
    await upload(20);

    expect((await getInfo("libro-1")).status).toBe(200);
    expect((await patchCopies("libro-1", { digital_copies: 5 })).status).toBe(200);
  });

  it("consultar y fijar copias no gastan el cupo de subidas", async () => {
    for (let i = 0; i < 25; i += 1) {
      expect((await getInfo("libro-1")).status).toBe(200);
      expect((await patchCopies("libro-1", { digital_copies: i })).status).toBe(200);
    }

    await upload(20);
  });

  it("un prestatario que insiste recibe siempre 403 y no gasta el cupo de nadie", async () => {
    signInAs("ESTUDIANTE", "alumno-1");
    for (let i = 0; i < 25; i += 1) {
      expect((await putContent("libro-1", "# Texto")).status).toBe(403);
    }

    signInAs("BIBLIOTECARIO", "staff-1");

    await upload(20);
  });

  it("otro origen se rechaza con 403 antes de contar para el límite", async () => {
    const crossSite = { "content-type": "application/json", "sec-fetch-site": "cross-site" };
    for (let i = 0; i < 25; i += 1) {
      expect((await putContent("libro-1", "# Texto", crossSite)).status).toBe(403);
    }

    await upload(20);
  });

  it("el límite cuenta también las subidas que fallan por contenido inválido", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await putContent("libro-1", "")).status).toBe(400);
    }

    expect((await putContent("libro-1", "# Válida")).status).toBe(429);
  });
});
