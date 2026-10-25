import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

/** S1 · regla 3 y ADR-0008: cabeceras de seguridad en todas las rutas; la CSP solo en producción. */
type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function loadRules(): Promise<HeaderRule[]> {
  if (nextConfig.headers === undefined) {
    throw new Error("next.config.ts no define headers()");
  }
  return nextConfig.headers();
}

async function headersOf(): Promise<Map<string, string>> {
  const rules = await loadRules();
  const map = new Map<string, string>();
  for (const rule of rules) {
    for (const header of rule.headers) {
      map.set(header.key, header.value);
    }
  }
  return map;
}

/** La directiva `connect-src` de la CSP actual (vacía si no existe). */
async function connectSrc(): Promise<string> {
  const csp = (await headersOf()).get("Content-Security-Policy") ?? "";
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("connect-src")) ?? ""
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("S1 · cabeceras de seguridad (todas las rutas)", () => {
  it("se aplican a todas las rutas", async () => {
    const rules = await loadRules();

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => rule.source === "/:path*")).toBe(true);
  });

  it.each(["development", "test", "production"])("con NODE_ENV=%s incluyen las cabeceras base", async (env) => {
    vi.stubEnv("NODE_ENV", env);

    const headers = await headersOf();

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.has("Referrer-Policy")).toBe(true);
    expect(headers.has("Permissions-Policy")).toBe(true);
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
  });

  it("Referrer-Policy no envía la URL completa a otros orígenes", async () => {
    const value = (await headersOf()).get("Referrer-Policy") ?? "";

    expect(["strict-origin-when-cross-origin", "strict-origin", "same-origin", "no-referrer"]).toContain(value);
  });

  it("HSTS dura al menos un año", async () => {
    const value = (await headersOf()).get("Strict-Transport-Security") ?? "";
    const seconds = Number(/max-age=(\d+)/.exec(value)?.[1]);

    expect(seconds).toBeGreaterThanOrEqual(31_536_000);
  });

  it("Permissions-Policy desactiva al menos cámara, micrófono y geolocalización", async () => {
    const value = (await headersOf()).get("Permissions-Policy") ?? "";

    expect(value).toContain("camera=()");
    expect(value).toContain("microphone=()");
    expect(value).toContain("geolocation=()");
  });
});

describe("S1 · Content-Security-Policy", () => {
  it.each([
    "development",
    "test",
  ])("no existe con NODE_ENV=%s (el modo desarrollo de Next necesita eval)", async (env) => {
    vi.stubEnv("NODE_ENV", env);

    expect((await headersOf()).has("Content-Security-Policy")).toBe(false);
  });

  it("existe con NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await headersOf()).has("Content-Security-Policy")).toBe(true);
  });

  it("en producción prohíbe ser embebida y los plugins, y limita todo a mismo origen por defecto", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const csp = (await headersOf()).get("Content-Security-Policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it.each([
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
  ])("connect-src permite %s (sin él, el ingreso con Firebase falla en producción)", async (domain) => {
    vi.stubEnv("NODE_ENV", "production");

    const connect = await connectSrc();

    expect(connect.split(/\s+/)).toContain(domain);
    expect(connect).toContain("'self'");
  });

  it("connect-src ya no permite https://www.googleapis.com (S1 regla 18)", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const connect = await connectSrc();

    expect(connect.split(/\s+/)).not.toContain("https://www.googleapis.com");
    expect(connect).not.toContain("www.googleapis.com");
  });

  it("connect-src no permite apis.google.com (el ingreso sin ventanas emergentes no lo necesita)", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await connectSrc()).includes("apis.google.com")).toBe(false);
  });

  it("connect-src no abre cualquier destino (sin comodín *)", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const csp = (await headersOf()).get("Content-Security-Policy") ?? "";
    const connect =
      csp
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("connect-src")) ?? "";

    expect(connect.split(/\s+/)).not.toContain("*");
  });

  it("las cabeceras base siguen presentes en producción junto a la CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const headers = await headersOf();

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
